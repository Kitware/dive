import json
from typing import Dict, List, Optional, Tuple

from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.assetstore import Assetstore
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.setting import Setting
from girder.models.token import Token
from girder.models.upload import Upload
from girder_jobs.models.job import Job
import pymongo

from dive_server import crud, crud_annotation
from dive_tasks import tasks
from dive_utils import TRUTHY_META_VALUES, asbool, constants, fromMeta, models, slugify, types
from dive_utils.serializers import kwcoco, meva, viame

from . import crud_dataset


def _get_queue_name(user: types.GirderUserModel, default="celery") -> str:
    if user.get(constants.UserPrivateQueueEnabledMarker, False):
        return f'{user["login"]}@private'
    return default


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


def load_pipelines(user: types.GirderUserModel) -> Dict[str, types.PipelineCategory]:
    """Load all static and dynamic pipelines"""
    static_job_configs: types.AvailableJobSchema = (
        Setting().get(constants.SETTINGS_CONST_JOBS_CONFIGS) or tasks.EMPTY_JOB_SCHEMA
    )
    static_pipelines = static_job_configs.get('pipelines', {})
    dynamic_pipelines = _load_dynamic_pipelines(user)
    static_pipelines.update(dynamic_pipelines)
    return static_pipelines


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
    existing_jobs = Job().findOne(
        {
            constants.JOBCONST_DATASET_ID: folder_id_str,
            'status': {
                # Find jobs that are inactive, queued, or running
                # https://github.com/girder/girder/blob/main/plugins/jobs/girder_jobs/constants.py
                '$in': [0, 1, 2]
            },
        }
    )
    if existing_jobs is not None:
        raise RestException(
            (
                f"A pipeline for {folder_id_str} is already running. "
                "Only one outstanding job may be run at a time for "
                "a dataset."
            )
        )

    token = Token().createToken(user=user, days=14)

    requires_input = False  # include CSV input for pipe
    if pipeline["type"] == constants.TrainedPipelineCategory:
        # Verify that the user has READ access to the pipe they want to run
        pipeFolder = Folder().load(pipeline["folderId"], level=AccessType.READ, user=user)
        requires_input = asbool(fromMeta(pipeFolder, "requires_input"))
    elif pipeline["pipe"].startswith('utility_'):
        # TODO Temporary inclusion of utility pipes which take csv input
        requires_input = True

    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)

    params: types.PipelineJob = {
        "input_folder": folder_id_str,
        "input_type": fromMeta(folder, "type", required=True),
        "output_folder": folder_id_str,
        "pipeline": pipeline,
        "requires_input": requires_input,
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
    newjob.job[constants.JOBCONST_RESULTS_FOLDER_ID] = folder_id_str
    newjob.job[constants.JOBCONST_PIPELINE_NAME] = pipeline['name']
    # Allow any users with accecss to the input data to also
    # see and possibly manage the job
    Job().copyAccessPolicies(folder, newjob.job)
    Job().save(newjob.job)
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
    folderIds: List[str],
    pipelineName: str,
    config: str,
    annotatedFramesOnly: bool,
) -> types.GirderModel:
    folder_list = []
    if folderIds is None or len(folderIds) == 0:
        raise RestException("No folderIds in param")

    for folderId in folderIds:
        # Ensure user has read permissions to run training on every folder requested
        folder = Folder().load(folderId, level=AccessType.READ, user=user)
        if folder is None:
            raise RestException(f"Cannot access folder {folderId}")
        crud.getCloneRoot(user, folder)
        folder_list.append(folder)

    # Ensure the folder to upload results to exists
    results_folder = training_output_folder(user)
    output_folders = list(
        Folder().find(
            query={
                'parentId': results_folder['_id'],
                'name': pipelineName,
            },
            user=user,
            limit=1,
        )
    )
    if len(output_folders):
        raise RestException(
            f'Output pipeline "{pipelineName}" already exists, please choose a different name'
        )
    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)
    newjob = tasks.train_pipeline.apply_async(
        queue=_get_queue_name(user, "training"),
        kwargs=dict(
            results_folder=results_folder,
            source_folder_list=folder_list,
            pipeline_name=pipelineName,
            config=config,
            annotated_frames_only=annotatedFramesOnly,
            girder_client_token=str(token["_id"]),
            girder_job_title=(f"Running training on {len(folder_list)} datasets"),
            girder_job_type="private" if job_is_private else "training",
        ),
    )
    newjob.job[constants.JOBCONST_PRIVATE_QUEUE] = job_is_private
    newjob.job[constants.JOBCONST_TRAINING_INPUT_IDS] = folderIds
    newjob.job[constants.JOBCONST_RESULTS_FOLDER_ID] = str(results_folder['_id'])
    newjob.job[constants.JOBCONST_TRAINING_CONFIG] = config
    newjob.job[constants.JOBCONST_PIPELINE_NAME] = pipelineName
    Job().save(newjob.job)
    return newjob.job


def _get_data_by_type(
    file: Optional[types.GirderModel], as_type: Optional[crud.FileType] = None
) -> Tuple[Optional[crud.FileType], dict, dict]:
    """
    Given an arbitrary Girder file model, figure out what kind of file it is and
    parse it appropriately.

    :as_type: bypass type discovery (potentially expensive) if caller is certain about type
    """
    if file is None:
        return None, {}, {}
    file_string = b"".join(list(File().download(file, headers=False)())).decode()
    data_dict = None

    # If the caller has not specified a type, try to discover it
    if as_type is None:
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
        else:
            raise RestException('Got file of unknown and unusable type')

    # Parse the file as the now known type
    if as_type == crud.FileType.VIAME_CSV:
        tracks, attributes = viame.load_csv_as_tracks_and_attributes(file_string.splitlines())
        return as_type, tracks, attributes

    # All filetypes below are JSON, so if as_type was specified, it needs to be loaded.
    if data_dict is None:
        data_dict = json.loads(file_string)

    if as_type == crud.FileType.COCO_JSON:
        tracks, attributes = kwcoco.load_coco_as_tracks_and_attributes(data_dict)
        return as_type, tracks, attributes
    if as_type == crud.FileType.DIVE_CONF or as_type == crud.FileType.DIVE_JSON:
        return as_type, data_dict, {}
    return None, {}, {}


def process_items(folder: types.GirderModel, user: types.GirderUserModel):
    """
    Discover unprocessed items in a dataset and process them by type in order of creation
    """
    unprocessed_items = Folder().childItems(
        folder,
        filters={
            "$or": [
                {"lowerName": {"$regex": constants.csvRegex}},
                {"lowerName": {"$regex": constants.jsonRegex}},
            ]
        },
        # Processing order: oldest to newest
        sort=[("created", pymongo.ASCENDING)],
    )
    auxiliary = crud.get_or_create_auxiliary_folder(folder, user)
    for item in unprocessed_items:
        file = next(Item().childFiles(item), None)
        if file is None:
            raise RestException('Item had no associated files')

        try:
            filetype, data, attrs = _get_data_by_type(file)
        except Exception as e:
            Item().remove(item)
            raise RestException(f'{file["name"]} was not valid JSON or CSV: {e}') from e

        if filetype == crud.FileType.VIAME_CSV or filetype == crud.FileType.COCO_JSON:
            crud_annotation.save_annotations(
                folder,
                data.values(),
                [],
                user,
                overwrite=True,
                description=f"Import from {filetype.name}",
            )
            crud.saveImportAttributes(folder, attrs, user)
            Item().move(item, auxiliary)

        elif filetype == crud.FileType.DIVE_CONF:
            crud_dataset.update_metadata(folder, data)
            Item().remove(item)

        elif filetype == crud.FileType.DIVE_JSON:
            for track in data.values():
                if not isinstance(track, dict):
                    Item().remove(item)  # remove the bad JSON from dataset
                    raise RestException(
                        (
                            'Invalid JSON file provided.'
                            ' Please upload a COCO, KWCOCO, VIAME CSV, or DIVE JSON file.'
                        )
                    )
                crud.get_validated_model(models.Track, **track)
            crud_annotation.save_annotations(
                folder,
                data.values(),
                [],
                user,
                overwrite=True,
                description=f"Import from {filetype.value}",
            )
            Item().move(item, auxiliary)
        else:
            raise RestException(f'Unknown file type {filetype.name}')


def postprocess(
    user: types.GirderUserModel, dsFolder: types.GirderModel, skipJobs: bool
) -> types.GirderModel:
    """
    Post-processing to be run after media/annotation import

    When skipJobs=False, the following may run as jobs:
        Transcoding of Video
        Transcoding of Images
        Conversion of KPF annotations into track JSON

    In either case, the following may run synchronously:
        Conversion of CSV annotations into track JSON
    """
    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)
    auxiliary = crud.get_or_create_auxiliary_folder(dsFolder, user)
    isClone = fromMeta(dsFolder, constants.ForeignMediaIdMarker, None) is not None
    # add default confidence filter threshold to folder metadata
    dsFolder['meta'][constants.ConfidenceFiltersMarker] = {'default': 0.1}

    # Validate user-supplied metadata fields are present
    if fromMeta(dsFolder, constants.FPSMarker) is None:
        raise RestException(f'{constants.FPSMarker} missing from metadata')
    if fromMeta(dsFolder, constants.TypeMarker) is None:
        raise RestException(f'{constants.TypeMarker} missing from metadata')

    if not skipJobs and not isClone:
        token = Token().createToken(user=user, days=2)
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
                    girder_job_title=f"Converting {item['_id']} to a web friendly format",
                    girder_client_token=str(token["_id"]),
                    girder_job_type="private" if job_is_private else "convert",
                ),
            )
            newjob.job[constants.JOBCONST_PRIVATE_QUEUE] = job_is_private
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
                    girder_client_token=str(token["_id"]),
                    girder_job_title=f"Converting {dsFolder['_id']} to a web friendly format",
                    girder_job_type="private" if job_is_private else "convert",
                ),
            )
            newjob.job[constants.JOBCONST_PRIVATE_QUEUE] = job_is_private
            Job().save(newjob.job)

        elif imageItems.count() > 0:
            dsFolder["meta"][constants.DatasetMarker] = True

        # transform KPF if necessary
        ymlItems = Folder().childItems(
            dsFolder, filters={"lowerName": {"$regex": constants.ymlRegex}}
        )
        if ymlItems.count() > 0:
            # There might be up to 3 yamls
            def make_file_generator(item):
                file = Item().childFiles(item)[0]
                return File().download(file, headers=False)()

            allFiles = [make_file_generator(item) for item in ymlItems]
            data = meva.load_kpf_as_tracks(allFiles)
            crud_annotation.save_annotations(
                dsFolder, data.values(), [], user, overwrite=True, description="Import from KPF"
            )
            ymlItems.rewind()
            for item in ymlItems:
                Item().move(item, auxiliary)

        Folder().save(dsFolder)

    process_items(dsFolder, user)
    return dsFolder
