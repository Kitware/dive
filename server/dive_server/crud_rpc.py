from datetime import datetime, timedelta
import json
from typing import Dict, List, Optional, Tuple, TypedDict

from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.notification import Notification
from girder.models.setting import Setting
from girder.models.token import Token
from girder_jobs.models.job import Job, JobStatus
from girder_worker.girder_plugin.status import CustomJobStatus
from pydantic import BaseModel
import pymongo

from dive_server import crud, crud_annotation
from dive_tasks import tasks
from dive_utils import TRUTHY_META_VALUES, asbool, constants, fromMeta, models, types
from dive_utils.constants import TrainingModelExtensions
from dive_utils.serializers import dive, kpf, kwcoco, viame

from . import crud_dataset


class RunTrainingArgs(BaseModel):
    folderIds: List[str]
    labelText: Optional[str]
    model: Optional[types.TrainingModelTuneArgs]


def _get_queue_name(user: types.GirderUserModel, default="celery") -> str:
    if user.get(constants.UserPrivateQueueEnabledMarker, False):
        return f'{user["login"]}@private'
    return default


def _check_running_jobs(folder_id_str: str):
    """Find running jobs associated with the given folder"""
    return (
        Job().findOne(
            {
                constants.JOBCONST_DATASET_ID: folder_id_str,
                'status': {
                    '$in': [
                        # All possible states for an incomplete job
                        JobStatus.INACTIVE,
                        JobStatus.QUEUED,
                        JobStatus.RUNNING,
                        CustomJobStatus.CANCELING,
                        CustomJobStatus.CONVERTING_OUTPUT,
                        CustomJobStatus.CONVERTING_INPUT,
                        CustomJobStatus.FETCHING_INPUT,
                        CustomJobStatus.PUSHING_OUTPUT,
                    ],
                },
            }
        )
        is not None
    )


def _load_dynamic_pipelines(user: types.GirderUserModel) -> Dict[str, types.PipelineCategory]:
    """Add any additional dynamic pipelines to the existing pipeline list."""
    pipelines: Dict[str, types.PipelineCategory] = {}
    pipelines[constants.TrainedPipelineCategory] = {"pipes": [], "description": ""}
    for folder in Folder().findWithPermissions(
        query={f"meta.{constants.TrainedPipelineMarker}": {'$in': TRUTHY_META_VALUES}},
        user=user,
    ):
        pipename = None
        for item in Folder().childItems(folder):
            if item['name'].endswith('.pipe') and not item['name'].startswith('embedded_'):
                pipename = item['name']
                append_text = ''
                if pipename.endswith('tracker.pipe'):
                    append_text = ' tracker'
                elif pipename.endswith('detector.pipe'):
                    append_text = ' detector'
                pipelines[constants.TrainedPipelineCategory]["pipes"].append(
                    {
                        "name": f'{folder["name"]}{append_text}',
                        "type": constants.TrainedPipelineCategory,
                        "pipe": pipename,
                        "folderId": str(folder["_id"]),
                    }
                )
    return pipelines


def _load_dynamic_models(user: types.GirderUserModel) -> Dict[str, types.TrainingModelDescription]:
    """Add any additional dynamic models to the existing training models list."""
    training_models: Dict[str, types.TrainingModelDescription] = {}
    for folder in Folder().findWithPermissions(
        query={f"meta.{constants.TrainedPipelineMarker}": {'$in': TRUTHY_META_VALUES}},
        user=user,
    ):
        for item in Folder().childItems(folder):
            is_training_model = False
            match = None
            for extension in TrainingModelExtensions:
                if item['name'].endswith(extension):
                    is_training_model = True
                    match = extension
            if is_training_model and not item['name'].startswith('embedded_'):
                training_models[folder['name']] = {
                    "name": f"{folder['name']} - {item['name']}",
                    "type": match,
                    "folderId": str(folder["_id"]),
                }
    return training_models


def load_pipelines(user: types.GirderUserModel) -> Dict[str, types.PipelineCategory]:
    """Load all static and dynamic pipelines"""
    static_job_configs: types.AvailableJobSchema = (
        Setting().get(constants.SETTINGS_CONST_JOBS_CONFIGS) or tasks.EMPTY_JOB_SCHEMA
    )
    static_pipelines = static_job_configs.get('pipelines', {})
    dynamic_pipelines = _load_dynamic_pipelines(user)
    static_pipelines.update(dynamic_pipelines)
    return static_pipelines


def load_training_configs(user: types.GirderUserModel) -> Dict[str, types.TrainingModelDescription]:
    static_job_configs: types.AvailableJobSchema = (
        Setting().get(constants.SETTINGS_CONST_JOBS_CONFIGS) or tasks.EMPTY_JOB_SCHEMA
    )
    static_models = static_job_configs.get('models', {})
    dynamic_models = _load_dynamic_models(user)
    print(dynamic_models)
    static_models.update(dynamic_models)
    return static_models


def verify_pipe(user: types.GirderUserModel, pipeline: types.PipelineDescription):
    """Verify a pipeline exists and is runnable"""
    missing_exception = RestException(
        (
            f'No such pipeline exists for type={pipeline["type"]} pipe={pipeline["pipe"]}. '
            'A pipeline upgrade may be outstanding or somethiung might have gone wrong. '
            'If you think this is an error, contact the server operator.'
        )
    )
    all_pipelines = load_pipelines(user)
    try:
        category_pipes = all_pipelines[pipeline['type']]['pipes']
        matchs = [
            pipe
            for pipe in category_pipes
            if (
                pipe["pipe"] == pipeline["pipe"]
                and pipeline['type'] == pipe['type']
                and pipeline['folderId'] == pipe['folderId']
            )
        ]
        if len(matchs) != 1:
            raise missing_exception
    except KeyError:
        raise missing_exception


def run_pipeline(
    user: types.GirderUserModel,
    folder: types.GirderModel,
    pipeline: types.PipelineDescription,
) -> types.GirderModel:
    """
    Run a pipeline on a dataset.

    :param folder: The girder folder containing the dataset to run on.
    :param pipeline: The pipeline to run the dataset on.
    """
    verify_pipe(user, pipeline)
    crud.getCloneRoot(user, folder)
    folder_id_str = str(folder["_id"])
    # First, verify that no other outstanding jobs are running on this dataset
    if _check_running_jobs(folder_id_str):
        raise RestException(
            (
                f"A pipeline for {folder_id_str} is already running. "
                "Only one outstanding job may be run at a time for "
                "a dataset."
            )
        )

    token = Token().createToken(user=user, days=14)

    input_revision = None  # include CSV input for pipe
    if pipeline["type"] == constants.TrainedPipelineCategory:
        # Verify that the user has READ access to the pipe they want to run
        pipeFolder = Folder().load(pipeline["folderId"], level=AccessType.READ, user=user)
        if asbool(fromMeta(pipeFolder, "requires_input")):
            input_revision = crud_annotation.RevisionLogItem().latest(folder)
    elif pipeline["pipe"].startswith('utility_'):
        # TODO Temporary inclusion of utility pipes which take csv input
        input_revision = crud_annotation.RevisionLogItem().latest(folder)

    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)

    params: types.PipelineJob = {
        "pipeline": pipeline,
        "input_folder": folder_id_str,
        "input_type": fromMeta(folder, "type", required=True),
        "output_folder": folder_id_str,
        "input_revision": input_revision,
        'user_id': str(user.get('_id', 'unknown')),
        'user_login': user.get('login', 'unknown'),
    }
    newjob = tasks.run_pipeline.apply_async(
        queue=_get_queue_name(user, "pipelines"),
        kwargs=dict(
            params=params,
            girder_job_title=f"Running {pipeline['name']} on {str(folder['name'])}",
            girder_client_token=str(token["_id"]),
            girder_job_type="private" if job_is_private else "pipelines",
        ),
    )
    newjob.job[constants.JOBCONST_PRIVATE_QUEUE] = job_is_private
    newjob.job[constants.JOBCONST_DATASET_ID] = folder_id_str
    newjob.job[constants.JOBCONST_PARAMS] = params
    newjob.job[constants.JOBCONST_CREATOR] = str(user['_id'])
    # Allow any users with accecss to the input data to also
    # see and possibly manage the job
    Job().copyAccessPolicies(folder, newjob.job)
    Job().save(newjob.job)
    # Inform Client of new Job added in inactive state
    Notification().createNotification(
        type='job_status',
        data=newjob.job,
        user=user,
        expires=datetime.now() + timedelta(seconds=30),
    )
    return newjob.job


def training_output_folder(user: types.GirderUserModel) -> types.GirderModel:
    """Ensure that the user has a training results folder."""
    viameFolder = Folder().createFolder(
        user,
        constants.ViameDataFolderName,
        description="VIAME data storage.",
        parentType="user",
        public=False,
        creator=user,
        reuseExisting=True,
    )

    return Folder().createFolder(
        viameFolder,
        constants.TrainingOutputFolderName,
        description="Results from VIAME model training are placed here.",
        public=False,
        creator=user,
        reuseExisting=True,
    )


def run_training(
    user: types.GirderUserModel,
    token: types.GirderModel,
    bodyParams: RunTrainingArgs,
    pipelineName: str,
    config: str,
    annotatedFramesOnly: bool,
) -> types.GirderModel:
    dataset_input_list: List[Tuple[str, int]] = []
    if len(bodyParams.folderIds) == 0:
        raise RestException("No folderIds in param")

    for folderId in bodyParams.folderIds:
        folder = Folder().load(folderId, level=AccessType.READ, user=user)
        if folder is None:
            raise RestException(f"Cannot access folder {folderId}")
        crud.getCloneRoot(user, folder)
        dataset_input_list.append((folderId, crud_annotation.RevisionLogItem().latest(folder)))

    # Ensure the folder to upload results to exists
    results_folder = training_output_folder(user)
    if Folder().findOne({'parentId': results_folder['_id'], 'name': pipelineName}):
        raise RestException(
            f'Output pipeline "{pipelineName}" already exists, please choose a different name'
        )

    params: types.TrainingJob = {
        'results_folder_id': results_folder['_id'],
        'dataset_input_list': dataset_input_list,
        'pipeline_name': pipelineName,
        'config': config,
        'annotated_frames_only': annotatedFramesOnly,
        'label_txt': bodyParams.labelText,
        'model': bodyParams.model,
        'user_id': user.get('_id', 'unknown'),
        'user_login': user.get('login', 'unknown'),
    }
    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)
    newjob = tasks.train_pipeline.apply_async(
        queue=_get_queue_name(user, "training"),
        kwargs=dict(
            params=params,
            girder_client_token=str(token["_id"]),
            girder_job_title=(f"Training to create {pipelineName} pipeline"),
            girder_job_type="private" if job_is_private else "training",
        ),
    )
    newjob.job[constants.JOBCONST_PRIVATE_QUEUE] = job_is_private
    newjob.job[constants.JOBCONST_PARAMS] = params
    newjob.job[constants.JOBCONST_CREATOR] = str(user['_id'])
    Job().save(newjob.job)
    return newjob.job


GetDataReturnType = TypedDict(
    'GetDataReturnType',
    {
        'annotations': Optional[types.DIVEAnnotationSchema],
        'meta': Optional[dict],
        'attributes': Optional[dict],
        'type': crud.FileType,
    },
)


def _get_data_by_type(
    file: types.GirderModel,
    image_map: Optional[Dict[str, int]] = None,
) -> Optional[GetDataReturnType]:
    """
    Given an arbitrary Girder file model, figure out what kind of file it is and
    parse it appropriately.

    Any given file type can result in updates to annotations, metadata, and/or attributes

    :param file: Girder file model
    :param image_map: Mapping of image names to frame numbers
    """
    if file is None:
        return None
    file_generator = File().download(file, headers=False)()
    file_string = b"".join(list(file_generator)).decode()
    data_dict = None

    # Discover the type of the mystery file
    if file['exts'][-1] == 'csv':
        as_type = crud.FileType.VIAME_CSV
    elif file['exts'][-1] == 'json':
        data_dict = json.loads(file_string)
        if type(data_dict) is list:
            raise RestException('No array-type json objects are supported')
        if kwcoco.is_coco_json(data_dict):
            as_type = crud.FileType.COCO_JSON
        elif models.MetadataMutable.is_dive_configuration(data_dict):
            data_dict = models.MetadataMutable(**data_dict).dict(exclude_none=True)
            as_type = crud.FileType.DIVE_CONF
        else:
            as_type = crud.FileType.DIVE_JSON
    elif file['exts'][-1] in ['yml', 'yaml']:
        as_type = crud.FileType.MEVA_KPF
    else:
        raise RestException('Got file of unknown and unusable type')

    # Parse the file as the now known type
    if as_type == crud.FileType.VIAME_CSV:
        converted, attributes = viame.load_csv_as_tracks_and_attributes(
            file_string.splitlines(), image_map
        )
        return {'annotations': converted, 'meta': None, 'attributes': attributes, 'type': as_type}
    if as_type == crud.FileType.MEVA_KPF:
        converted, attributes = kpf.convert(kpf.load(file_string))
        return {'annotations': converted, 'meta': None, 'attributes': attributes, 'type': as_type}

    # All filetypes below are JSON, so if as_type was specified, it needs to be loaded.
    if data_dict is None:
        data_dict = json.loads(file_string)
    if as_type == crud.FileType.COCO_JSON:
        converted, attributes = kwcoco.load_coco_as_tracks_and_attributes(data_dict)
        return {'annotations': converted, 'meta': None, 'attributes': attributes, 'type': as_type}
    if as_type == crud.FileType.DIVE_CONF:
        return {'annotations': None, 'meta': data_dict, 'attributes': None, 'type': as_type}
    if as_type == crud.FileType.DIVE_JSON:
        migrated = dive.migrate(data_dict)
        annotations, attributes = viame.load_json_as_track_and_attributes(data_dict)
        return {'annotations': migrated, 'meta': None, 'attributes': attributes, 'type': as_type}
    return None


def process_items(
    folder: types.GirderModel, user: types.GirderUserModel, additive=False, additivePrepend=''
):
    """
    Discover unprocessed items in a dataset and process them by type in order of creation
    """
    unprocessed_items = Folder().childItems(
        folder,
        filters={
            "$or": [
                {"lowerName": {"$regex": constants.csvRegex}},
                {"lowerName": {"$regex": constants.jsonRegex}},
                {"lowerName": {"$regex": constants.ymlRegex}},
            ]
        },
        # Processing order: oldest to newest
        sort=[("created", pymongo.ASCENDING)],
    )
    auxiliary = crud.get_or_create_auxiliary_folder(
        folder,
        user,
    )
    for item in unprocessed_items:
        file: Optional[types.GirderModel] = next(Item().childFiles(item), None)
        if file is None:
            raise RestException('Item had no associated files')

        try:
            image_map = None
            if fromMeta(folder, constants.TypeMarker) == 'image-sequence':
                image_map = crud.valid_image_names_dict(crud.valid_images(folder, user))
            results = _get_data_by_type(file, image_map=image_map)
        except Exception as e:
            Item().remove(item)
            raise RestException(f'{file["name"]} was not a supported file type: {e}') from e

        if results is None:
            Item().remove(item)
            raise RestException(f'Unknown file type for {file["name"]}')

        item['meta'][constants.ProcessedMarker] = True
        Item().move(item, auxiliary)
        if results['annotations']:
            updated_tracks = results['annotations']['tracks'].values()
            if additive:  # get annotations and add them to the end
                tracks = crud_annotation.add_annotations(
                    folder, results['annotations']['tracks'], additivePrepend
                )
                updated_tracks = tracks.values()
            crud_annotation.save_annotations(
                folder,
                user,
                upsert_tracks=updated_tracks,
                upsert_groups=results['annotations']['groups'].values(),
                overwrite=True,
                description=f'Import {results["type"].name} from {file["name"]}',
            )
        if results['attributes']:
            crud.saveImportAttributes(folder, results['attributes'], user)
        if results['meta']:
            crud_dataset.update_metadata(folder, results['meta'], False)


def postprocess(
    user: types.GirderUserModel,
    dsFolder: types.GirderModel,
    skipJobs: bool,
    skipTranscoding=False,
    additive=False,
    additivePrepend='',
) -> types.GirderModel:
    """
    Post-processing to be run after media/annotation import

    When skipJobs=False, the following may run as jobs:
        Transcoding of Video
        Transcoding of Images
        Conversion of KPF annotations into track JSON
        Extraction and upload of zip files

    In either case, the following may run synchronously:
        Conversion of CSV annotations into track JSON
    """
    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)
    isClone = dsFolder.get(constants.ForeignMediaIdMarker, None) is not None
    # add default confidence filter threshold to folder metadata
    dsFolder['meta'][constants.ConfidenceFiltersMarker] = {'default': 0.1}

    # Validate user-supplied metadata fields are present
    if fromMeta(dsFolder, constants.FPSMarker) is None:
        raise RestException(f'{constants.FPSMarker} missing from metadata')
    if fromMeta(dsFolder, constants.TypeMarker) is None:
        raise RestException(f'{constants.TypeMarker} missing from metadata')

    if not skipJobs and not isClone:
        token = Token().createToken(user=user, days=2)

        # extract ZIP Files if not already completed
        zipItems = list(
            Folder().childItems(
                dsFolder,
                filters={"lowerName": {"$regex": constants.zipRegex}},
            )
        )
        if len(zipItems) > 1:
            raise RestException('There are multiple zip files in the folder.')
        for item in zipItems:
            total_items = len(list((Folder().childItems(dsFolder))))
            if total_items > 1:
                raise RestException('There are multiple files besides a zip, cannot continue')
            newjob = tasks.extract_zip.apply_async(
                queue=_get_queue_name(user),
                kwargs=dict(
                    folderId=str(item["folderId"]),
                    itemId=str(item["_id"]),
                    user_id=str(user["_id"]),
                    user_login=str(user["login"]),
                    girder_job_title=f"Extracting {item['_id']} to folder {str(dsFolder['_id'])}",
                    girder_client_token=str(token["_id"]),
                    girder_job_type="private" if job_is_private else "convert",
                ),
            )
            newjob.job[constants.JOBCONST_PRIVATE_QUEUE] = job_is_private
            newjob.job[constants.JOBCONST_DATASET_ID] = str(item["folderId"])
            newjob.job[constants.JOBCONST_CREATOR] = str(user['_id'])
            Job().save(newjob.job)
            return dsFolder

        # transcode VIDEO if necessary
        videoItems = Folder().childItems(
            dsFolder, filters={"lowerName": {"$regex": constants.videoRegex}}
        )

        for item in videoItems:
            newjob = tasks.convert_video.apply_async(
                queue=_get_queue_name(user),
                kwargs=dict(
                    folderId=str(item["folderId"]),
                    itemId=str(item["_id"]),
                    user_id=str(user["_id"]),
                    user_login=str(user["login"]),
                    skip_transcoding=skipTranscoding,
                    girder_job_title=f"Converting {item['_id']} to a web friendly format",
                    girder_client_token=str(token["_id"]),
                    girder_job_type="private" if job_is_private else "convert",
                ),
            )
            newjob.job[constants.JOBCONST_PRIVATE_QUEUE] = job_is_private
            newjob.job[constants.JOBCONST_DATASET_ID] = dsFolder["_id"]
            Job().save(newjob.job)

        # transcode IMAGERY if necessary
        imageItems = Folder().childItems(
            dsFolder, filters={"lowerName": {"$regex": constants.imageRegex}}
        )
        safeImageItems = Folder().childItems(
            dsFolder, filters={"lowerName": {"$regex": constants.safeImageRegex}}
        )

        if imageItems.count() > safeImageItems.count():
            newjob = tasks.convert_images.apply_async(
                queue=_get_queue_name(user),
                kwargs=dict(
                    folderId=dsFolder["_id"],
                    user_id=str(user["_id"]),
                    user_login=str(user["login"]),
                    girder_client_token=str(token["_id"]),
                    girder_job_title=f"Converting {dsFolder['_id']} to a web friendly format",
                    girder_job_type="private" if job_is_private else "convert",
                ),
            )
            newjob.job[constants.JOBCONST_PRIVATE_QUEUE] = job_is_private
            newjob.job[constants.JOBCONST_DATASET_ID] = dsFolder["_id"]
            Job().save(newjob.job)

        elif imageItems.count() > 0:
            dsFolder["meta"][constants.DatasetMarker] = True

        Folder().save(dsFolder)

    process_items(dsFolder, user, additive, additivePrepend)
    return dsFolder
