from datetime import datetime, timedelta
import json
from typing import Dict, List, Literal, NamedTuple, Optional, Tuple, TypedDict, cast

from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.setting import Setting
from girder.models.token import Token
from girder.notification import Notification
from girder_jobs.models.job import Job, JobStatus
from girder_plugin_worker.status import CustomJobStatus
from pydantic import BaseModel
import pymongo
from typing_extensions import NotRequired

from dive_server import crud, crud_annotation, crud_dataset
from dive_tasks import tasks
from dive_tasks.multicam_pipeline import is_stereo_or_multicam_pipeline, pipeline_requires_input
from dive_tasks.utils import choose_annotation_fps
from dive_utils import (
    TRUTHY_META_VALUES,
    asbool,
    constants,
    frame_metadata,
    fromMeta,
    models,
    types,
)
from dive_utils.constants import TrainingModelExtensions
from dive_utils.serializers import dive, kpf, kwcoco, viame
from dive_utils.type_hierarchy import (
    HierarchyWrite,
    TypeHierarchyError,
    apply_hierarchy_write,
    normalize_type_hierarchy,
    resolve_type_hierarchy,
)


class RunTrainingArgs(BaseModel):
    folderIds: List[str]
    labelText: Optional[str]
    fineTuneModel: Optional[types.TrainingModelTuneArgs]


def _get_queue_name(user: types.GirderUserModel, default="celery") -> str:
    if user.get(constants.UserPrivateQueueEnabledMarker, False):
        return f'{user["login"]}@private'
    return default


def _persist_async_job_metadata(
    async_result,
    *,
    access_source: Optional[types.GirderModel] = None,
    **metadata: object,
) -> types.GirderModel:
    """
    Save DIVE-specific fields on a Celery job without clobbering worker status.

    GirderAsyncResult.job caches the document from first access (typically INACTIVE).
    Job().save() on that dict can race with the worker task_prerun RUNNING update:
    load(INACTIVE) -> worker sets RUNNING -> save(INACTIVE) leaves the job stuck
    INACTIVE, which breaks FETCHING_INPUT / PUSHING_OUTPUT transitions.
    """
    job = Job().load(async_result.job['_id'], force=True)
    other_fields = dict(metadata)
    if access_source is not None:
        Job().copyAccessPolicies(access_source, job)
        other_fields['public'] = job.get('public', False)
        if 'access' in job:
            other_fields['access'] = job['access']
    job = Job().updateJob(job, otherFields=other_fields, notify=False)
    job = Job().load(job['_id'], force=True)
    async_result._job = job
    return job


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

    trained_pipelines_query = {
        f"meta.{constants.TrainedPipelineMarker}": {'$in': TRUTHY_META_VALUES}
    }
    query = {'$and': [trained_pipelines_query, Folder().permissionClauses(user, AccessType.READ)]}
    models = [
        {'$match': query},
        {
            '$facet': {
                'results': [
                    {
                        '$lookup': {
                            'from': 'user',
                            'localField': 'creatorId',
                            'foreignField': '_id',
                            'as': 'ownerLogin',
                        },
                    },
                    {'$set': {'ownerLogin': {'$first': '$ownerLogin'}}},
                    {'$set': {'ownerLogin': '$ownerLogin.login'}},
                ],
                'totalCount': [{'$count': 'count'}],
            },
        },
    ]
    response = next(Folder().collection.aggregate(models))
    folders = [Folder().filter(doc, additionalKeys=['ownerLogin']) for doc in response['results']]

    for folder in folders:
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
                        "ownerLogin": folder["ownerLogin"],
                        "ownerId": folder["creatorId"],
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
            match = next(
                (
                    extension
                    for extension in TrainingModelExtensions
                    if item['name'].endswith(extension)
                ),
                None,
            )
            if match is not None:
                is_training_model = True
            if is_training_model and not item['name'].startswith('embedded_') and match:
                model: types.TrainingModelDescription = {
                    "name": f"{folder['name']} - {item['name']}",
                    "type": match,
                    "folderId": str(folder["_id"]),
                }
                training_models[folder['name']] = model
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
    force_transcoded=False,
    pipeline_params: Optional[types.PipelineParams] = None,
) -> types.GirderModel:
    """
    Run a pipeline on a dataset.

    :param folder: The girder folder containing the dataset to run on.
    :param pipeline: The pipeline to run the dataset on.
    :param force_transcoded: Force transcoding input.
    :param pipeline_params: Grouped pipeline params for runtime and KWIVER settings.
    """
    verify_pipe(user, pipeline)
    crud.getCloneRoot(user, folder)
    folder_id_str = str(folder["_id"])

    # Single-camera pipelines may target a per-camera child folder. Attribute the
    # job to the multicam parent so the viewer tracks running/complete state.
    multicam_parent = crud.get_multicam_parent_folder(folder, user)
    camera_name: Optional[str] = None
    job_dataset_id = folder_id_str
    if multicam_parent is not None:
        camera_name = crud.get_multicam_camera_name(folder, multicam_parent)
        job_dataset_id = str(multicam_parent["_id"])

    # First, verify that no other outstanding jobs are running on this dataset
    if _check_running_jobs(job_dataset_id) or (
        job_dataset_id != folder_id_str and _check_running_jobs(folder_id_str)
    ):
        raise RestException(
            (
                f"A pipeline for {job_dataset_id} is already running. "
                "Only one outstanding job may be run at a time for "
                "a dataset."
            )
        )

    token = Token().createToken(user=user, days=14)

    dataset_type = fromMeta(folder, "type", required=True)
    stereo_or_multicam = is_stereo_or_multicam_pipeline(pipeline)
    if dataset_type == constants.MultiType and not stereo_or_multicam:
        raise RestException(
            'Single-camera pipelines cannot run on a multicamera parent dataset. '
            'Use a stereo or multicam pipeline, or run on an individual camera folder.',
            code=400,
        )
    if stereo_or_multicam and dataset_type != constants.MultiType:
        raise RestException(
            'Stereo and multicam pipelines require a multicamera dataset',
            code=400,
        )

    input_revision = None  # include CSV input for pipe
    multicam_requires_input = False
    if pipeline["type"] == constants.TrainedPipelineCategory:
        # Verify that the user has READ access to the pipe they want to run
        pipeFolder = Folder().load(pipeline["folderId"], level=AccessType.READ, user=user)
        if asbool(fromMeta(pipeFolder, "requires_input")):
            input_revision = crud_annotation.RevisionLogItem().latest(folder)
    elif pipeline_requires_input(pipeline) and dataset_type != constants.MultiType:
        input_revision = crud_annotation.RevisionLogItem().latest(folder)
    elif pipeline_requires_input(pipeline) and dataset_type == constants.MultiType:
        multicam_requires_input = True

    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)

    runtime_params = (pipeline_params or {}).get("runtimeParams")
    kwiver_params = (pipeline_params or {}).get("kwiverParams")
    output_dataset_name = (pipeline_params or {}).get("outputDatasetName")
    output_parent_folder_id = (pipeline_params or {}).get("outputParentFolderId")
    if output_parent_folder_id:
        # Fail early if the user cannot write the chosen destination.
        Folder().load(output_parent_folder_id, level=AccessType.WRITE, user=user, exc=True)

    input_type = dataset_type
    multicam_cameras: List[types.MulticamCameraJob] = []
    multicam_default_display = ''
    calibration_item_id: Optional[str] = None
    default_camera_folder: Optional[types.GirderModel] = None

    if dataset_type == constants.MultiType:
        multi_cam = fromMeta(folder, constants.MultiCamMarker, required=True)
        multicam_default_display = multi_cam['defaultDisplay']
        camera_order = crud_dataset._multicam_camera_order(multi_cam)
        cameras_meta = multi_cam.get('cameras') or {}
        for name in camera_order:
            cam_info = cameras_meta[name]
            folder_id = cam_info.get('folderId')
            child = Folder().load(folder_id, level=AccessType.READ, user=user)
            if child is None:
                raise RestException(f'Camera folder for "{name}" was not found', code=404)
            if name == multicam_default_display:
                default_camera_folder = child
            cam_type = cam_info.get('type') or fromMeta(child, constants.TypeMarker)
            camera_job: types.MulticamCameraJob = {
                'name': name,
                'folder_id': str(child['_id']),
                'media_type': cam_type,
            }
            if multicam_requires_input:
                camera_job['input_revision'] = crud_annotation.RevisionLogItem().latest(child)
            multicam_cameras.append(camera_job)
        default_cam = next(
            (cam for cam in multicam_cameras if cam['name'] == multicam_default_display),
            None,
        )
        if default_cam is None:
            raise RestException(
                f'defaultDisplay "{multicam_default_display}" is not a configured camera',
                code=400,
            )
        input_type = default_cam['media_type']
        calibration_item_id = crud_dataset.resolve_stereo_calibration_item_id(folder, pipeline)
        needs_calibration = crud_dataset.pipeline_requires_calibration(pipeline)
        if needs_calibration and calibration_item_id is None:
            raise RestException(
                'This pipeline requires a calibration file. '
                'Import or attach a calibration file to the dataset.',
                code=404,
            )

    # Resolve the dataset's optional metadata file for pipelines that opt in via a
    # `# Metadata File: <block>:<key>` header. Scope precedence mirrors what the metadata
    # panel resolves: a single-camera run prefers its own camera's attachment and falls
    # back to the multicam parent's shared one, a stereo/multicam run prefers the shared
    # attachment and falls back to the default display camera's. Every lookup goes through
    # the one resolver that owns "what is this scope's attachment", so a run and the panel
    # never disagree.
    metadata_file_key = (pipeline.get("metadata") or {}).get("metadataFileKey")
    metadata_file_item_id: Optional[str] = None
    if metadata_file_key:
        scope_item_ids = (
            crud_dataset.resolve_metadata_attachment_item_id(scope, user)
            for scope in (folder, multicam_parent, default_camera_folder)
            if scope is not None
        )
        metadata_file_item_id = next((item_id for item_id in scope_item_ids if item_id), None)

    params: types.MulticamPipelineJob = {
        "pipeline": pipeline,
        "input_folder": folder_id_str,
        "input_type": input_type,
        "output_folder": folder_id_str,
        "input_revision": input_revision,
        'user_id': str(user.get('_id', 'unknown')),
        'user_login': user.get('login', 'unknown'),
        'force_transcoded': force_transcoded,
        'runtime_params': runtime_params,
        'kwiver_params': kwiver_params,
    }
    if output_dataset_name:
        params['output_dataset_name'] = output_dataset_name
    if output_parent_folder_id:
        params['output_parent_folder_id'] = output_parent_folder_id
    if camera_name:
        params['camera_name'] = camera_name
        multi_cam_meta = fromMeta(multicam_parent, constants.MultiCamMarker, default={}) or {}
        default_display = multi_cam_meta.get('defaultDisplay')
        if default_display:
            params['multicam_default_display'] = default_display
    if multicam_cameras:
        params['multicam_cameras'] = multicam_cameras
        params['multicam_default_display'] = multicam_default_display
        params['multicam_requires_input'] = multicam_requires_input
        if calibration_item_id:
            params['calibration_item_id'] = calibration_item_id
    if metadata_file_key and metadata_file_item_id:
        params['metadata_file_key'] = metadata_file_key
        params['metadata_file_item_id'] = metadata_file_item_id
    job_title = f"Running {pipeline['name']} on {str(folder['name'])}"
    if multicam_parent is not None and camera_name:
        job_title = (
            f"Running {pipeline['name']} on {str(multicam_parent['name'])} "
            f"with camera: {camera_name}"
        )

    newjob = tasks.run_pipeline.apply_async(
        queue=_get_queue_name(user, "pipelines"),
        kwargs=dict(
            params=params,
            girder_job_title=job_title,
            girder_client_token=str(token["_id"]),
            girder_job_type="private" if job_is_private else "pipelines",
        ),
    )
    job = _persist_async_job_metadata(
        newjob,
        access_source=folder,
        **{
            constants.JOBCONST_PRIVATE_QUEUE: job_is_private,
            constants.JOBCONST_DATASET_ID: job_dataset_id,
            constants.JOBCONST_PARAMS: params,
            constants.JOBCONST_CREATOR: str(user['_id']),
        },
    )
    if metadata_file_key and not metadata_file_item_id:
        # Same shape as the missing-calibration notice the task writes: the run continues
        # without the `-s <block>:<key>=<path>` setting, so say so instead of dropping it.
        Job().updateJob(
            job,
            log=(
                f'Warning: {pipeline["pipe"]} declares metadata file key {metadata_file_key} '
                'but this dataset has no metadata attachment; '
                'running without the metadata file setting\n'
            ),
        )
    # Inform Client of new Job added in inactive state
    Notification(
        type='job_status',
        data=job,
        user=user,
    ).flush()
    return job


def export_trained_pipeline(
    user: types.GirderUserModel,
    model_folder: types.GirderModel,
    export_folder: types.GirderModel,
) -> types.GirderModel:
    model_folder_id_str = str(model_folder["_id"])
    export_folder_id_str = str(export_folder['_id'])
    token = Token().createToken(user=user, days=14)

    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)

    params: types.PipelineJob = {
        "input_folder": model_folder_id_str,
        "output_folder": export_folder_id_str,
        "output_name": "model.onnx",
        'user_id': str(user.get('_id', 'unknown')),
        'user_login': user.get('login', 'unknown'),
    }
    newjob = tasks.export_trained_pipeline.apply_async(
        queue=_get_queue_name(user, "pipelines"),
        kwargs=dict(
            params=params,
            girder_job_title=f"Exporting {str(model_folder['name'])} to ONNX",
            girder_client_token=str(token["_id"]),
            girder_job_type="private" if job_is_private else "export",
        ),
    )

    job = _persist_async_job_metadata(
        newjob,
        access_source=model_folder,
        **{
            constants.JOBCONST_PRIVATE_QUEUE: job_is_private,
            constants.JOBCONST_PARAMS: params,
            constants.JOBCONST_CREATOR: str(user['_id']),
        },
    )
    # Inform Client of new Job added in inactive state
    Notification(
        type='job_status',
        data=job,
        user=user,
    ).flush()
    return job


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
    force_transcoded=False,
) -> types.GirderModel:
    dataset_input_list: List[Tuple[str, int]] = []
    if len(bodyParams.folderIds) == 0:
        raise RestException("No folderIds in param")

    for folderId in bodyParams.folderIds:
        folder = Folder().load(folderId, level=AccessType.READ, user=user)
        if folder is None:
            raise RestException(f"Cannot access folder {folderId}")
        crud.assert_training_allowed_folder(user, folder)
        crud.getCloneRoot(user, folder)
        dataset_input_list.append((folderId, crud_annotation.RevisionLogItem().latest(folder)))

    # Ensure the folder to upload results to exists
    results_folder = training_output_folder(user)
    if Folder().findOne({'parentId': results_folder['_id'], 'name': pipelineName}):
        raise RestException(
            f'Output pipeline "{pipelineName}" already exists, please choose a different name'
        )
    # Use a plain dict for model so serialization (Celery/MongoDB) never sees a Pydantic model
    fineTuneModel = None
    if bodyParams.fineTuneModel:
        fineTuneModel = bodyParams.fineTuneModel.model_dump()

    params: types.TrainingJob = {
        'results_folder_id': results_folder['_id'],
        'dataset_input_list': dataset_input_list,
        'pipeline_name': pipelineName,
        'config': config,
        'annotated_frames_only': annotatedFramesOnly,
        'label_txt': bodyParams.labelText,
        'model': fineTuneModel,
        'user_id': user.get('_id', 'unknown'),
        'user_login': user.get('login', 'unknown'),
        'force_transcoded': force_transcoded,
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
    return _persist_async_job_metadata(
        newjob,
        **{
            constants.JOBCONST_PRIVATE_QUEUE: job_is_private,
            constants.JOBCONST_PARAMS: params,
            constants.JOBCONST_CREATOR: str(user['_id']),
        },
    )


GetDataReturnType = TypedDict(
    'GetDataReturnType',
    {
        'annotations': Optional[types.DIVEAnnotationSchema],
        'meta': Optional[dict],
        'attributes': Optional[dict],
        'type': crud.FileType,
        'hierarchy': NotRequired[Optional[Dict[str, str]]],
    },
)


def _frame_metadata_kept_warning(name: str) -> str:
    """Notice that a file was kept as a frame-metadata sidecar rather than imported."""
    return f'{name} was stored as frame metadata, not annotations; it stays in the dataset folder.'


def _get_data_by_type(
    file: types.GirderModel,
    image_map: Optional[Dict[str, int]] = None,
    configuration_only: bool = False,
) -> Tuple[Optional[GetDataReturnType], Optional[List[str]]]:
    """
    Given an arbitrary Girder file model, figure out what kind of file it is and
    parse it appropriately.

    Any given file type can result in updates to annotations, metadata, and/or attributes

    :param file: Girder file model
    :param image_map: Mapping of image names to frame numbers
    """
    if file is None:
        return None, None
    file_generator = File().download(file, headers=False)()
    file_string = b"".join(list(file_generator)).decode()
    data_dict = None
    warnings = None

    # Discover the type of the mystery file
    if file['exts'][-1] == 'csv':
        as_type = crud.FileType.VIAME_CSV
    elif file['exts'][-1] == 'json':
        try:
            data_dict = json.loads(file_string)
        except json.JSONDecodeError:
            if configuration_only:
                return None, None
            raise
        if type(data_dict) is list:
            if configuration_only:
                return None, None
            raise RestException('No array-type json objects are supported')
        if configuration_only and not isinstance(data_dict, dict):
            return None, None
        if kwcoco.is_coco_json(data_dict):
            as_type = crud.FileType.COCO_JSON
        elif models.MetadataMutable.is_dive_configuration(data_dict):
            hierarchy_present = 'typeHierarchy' in data_dict
            raw_hierarchy = data_dict.get('typeHierarchy')
            if hierarchy_present:
                normalize_type_hierarchy(raw_hierarchy)
            data_dict = models.MetadataMutable(**data_dict).dict(exclude_none=True)
            if hierarchy_present:
                # Pydantic drops explicit null. Preserve the raw instruction so additive
                # import can distinguish an empty no-op from an explicit deletion.
                data_dict['typeHierarchy'] = raw_hierarchy
            as_type = crud.FileType.DIVE_CONF
        else:
            as_type = crud.FileType.DIVE_JSON
    elif file['exts'][-1] in ['yml', 'yaml']:
        as_type = crud.FileType.MEVA_KPF
    else:
        raise RestException('Got file of unknown and unusable type')

    if configuration_only and as_type not in (crud.FileType.DIVE_CONF, crud.FileType.COCO_JSON):
        return None, None

    # Parse the file as the now known type
    if as_type == crud.FileType.VIAME_CSV:
        (
            converted,
            attributes,
            warnings,
            fps,
            datasetInfo,
        ) = viame.load_csv_as_tracks_and_attributes(file_string.splitlines(), image_map)
        meta = {
            **({'fps': fps} if fps is not None else {}),
            **({'datasetInfo': datasetInfo} if datasetInfo else {}),
        }
        return {
            'annotations': converted,
            'meta': meta,
            'attributes': attributes,
            'type': as_type,
        }, warnings
    if as_type == crud.FileType.MEVA_KPF:
        converted, attributes = kpf.convert(kpf.load(file_string))
        return {
            'annotations': converted,
            'meta': None,
            'attributes': attributes,
            'type': as_type,
        }, warnings

    # All filetypes below are JSON, so if as_type was specified, it needs to be loaded.
    if data_dict is None:
        data_dict = json.loads(file_string)
    if as_type == crud.FileType.COCO_JSON:
        (
            converted,
            attributes,
            coco_warnings,
            datasetInfo,
        ) = kwcoco.load_coco_as_tracks_and_attributes(data_dict)
        hierarchy, hierarchy_warnings = kwcoco.type_hierarchy_from_categories(data_dict)
        coco_fps = kwcoco.frame_rate_from_coco(data_dict)
        coco_meta = {
            **({"datasetInfo": datasetInfo} if datasetInfo else {}),
            **({'fps': coco_fps} if coco_fps is not None else {}),
        }
        return {
            'annotations': converted,
            'meta': coco_meta or None,
            'attributes': attributes,
            'type': as_type,
            'hierarchy': hierarchy,
        }, (coco_warnings + hierarchy_warnings) or warnings
    if as_type == crud.FileType.DIVE_CONF:
        return {
            'annotations': None,
            'meta': data_dict,
            'attributes': None,
            'type': as_type,
        }, warnings
    if as_type == crud.FileType.DIVE_JSON:
        migrated = dive.migrate(data_dict)
        annotations, attributes = viame.load_json_as_track_and_attributes(data_dict)
        return {
            'annotations': migrated,
            'meta': None,
            'attributes': attributes,
            'type': as_type,
        }, warnings
    return None, None


def resolve_imported_dataset_info(existing: types.DatasetInfo, meta: dict, additive: bool) -> dict:
    """Return ``meta`` with its ``datasetInfo`` reconciled against the dataset's ``existing`` block.

    datasetInfo follows the import "Overwrite" checkbox, mirroring annotations: Overwrite
    (``additive=False``) replaces the block; additive merges per-key with imported values
    winning, so a re-import never clobbers station metadata the file omits. A file carrying
    no datasetInfo leaves ``existing`` untouched in either mode. Inputs are not mutated.
    """
    imported = meta.get('datasetInfo')
    if not imported:
        return meta
    resolved = {**existing, **imported} if additive else imported
    return {**meta, 'datasetInfo': resolved}


def _attach_swept_sidecar(folder: types.GirderModel, item: types.GirderModel):
    """Record a swept sidecar as the folder's explicit metadata attachment.

    Girder's save is a full-document replace and async jobs (convert_video) write folder
    meta while this sweep runs, so refresh first or their keys (annotate, originalFps,
    ffprobe_info) are replaced with this stale in-memory copy.
    """
    crud.refresh_folder_document(folder)
    folder['meta'][constants.MetadataFileItemIdMarker] = str(item['_id'])
    folder['meta'][constants.MetadataFileOriginalNameMarker] = item['name']
    Folder().save(folder)


def _unprocessed_data_items(folder: types.GirderModel) -> list:
    return list(
        Folder().childItems(
            folder,
            filters={
                "$and": [
                    {
                        "$or": [
                            {"lowerName": {"$regex": constants.csvRegex}},
                            {"lowerName": {"$regex": constants.jsonRegex}},
                            {"lowerName": {"$regex": constants.ymlRegex}},
                            # Reserved sidecar names include .txt, which no annotation
                            # extension covers. Sweeping them keeps all six behaving
                            # identically instead of leaving .txt undiscovered.
                            frame_metadata.frame_metadata_source_name_query(),
                        ]
                    },
                    # Frame-metadata sidecars are marked processed but stay in the dataset
                    # folder; excluding them here keeps a left-in-place sidecar from being
                    # re-swept on a later postprocess.
                    {f'meta.{constants.ProcessedMarker}': {'$ne': True}},
                ]
            },
            # Processing order: oldest to newest
            sort=[("created", pymongo.ASCENDING)],
        )
    )


def _declared_sidecar_predicate(folder: types.GirderModel, user: types.GirderUserModel):
    """Return the folder's attachment item id and a predicate identifying declared sidecars.

    Configuration staging and the import loop must agree on which items are sidecars, so
    both resolve the attachment through this one helper.
    """
    attachment_item_id = crud_dataset.resolve_metadata_attachment_item_id(folder, user)

    def is_declared_sidecar(item: types.GirderModel) -> bool:
        return str(item['_id']) == attachment_item_id or (
            frame_metadata.is_frame_metadata_source_name(item['name'])
        )

    return attachment_item_id, is_declared_sidecar


def _parse_data_item(
    item: types.GirderModel,
    file: types.GirderModel,
    image_map=None,
    configuration_only=False,
):
    try:
        results, warnings = _get_data_by_type(
            file,
            image_map=image_map,
            configuration_only=configuration_only,
        )
    except TypeHierarchyError as error:
        raise crud.hierarchy_rest_error(error) from error
    except Exception as error:
        Item().remove(item)
        if isinstance(error, ValueError):
            hint = (
                ' If this file is frame metadata rather than annotations, upload it '
                'in the "Metadata File (Optional)" field on the upload page, or rename '
                'it to frame-metadata.csv and re-upload.'
                if constants.csvRegex.search(file['name'])
                else ''
            )
            raise RestException(f'Failed to import {file["name"]}: {error}{hint}') from error
        raise RestException(f'{file["name"]} was not a supported file type: {error}') from error
    if results is None and not configuration_only:
        Item().remove(item)
        raise RestException(f'Unknown file type for {file["name"]}')
    return results, warnings


def _fresh_folder_snapshot(folder: types.GirderModel) -> types.GirderModel:
    fresh = Folder().load(folder['_id'], force=True)
    return cast(types.GirderModel, fresh) if isinstance(fresh, dict) else folder


class HierarchyInstruction(NamedTuple):
    present: bool
    hierarchy: object
    soft_warning: Optional[str] = None


def _resolve_configuration_hierarchy(
    existing: object,
    instructions: List[HierarchyInstruction],
    additive: bool,
) -> Tuple[HierarchyWrite, List[str]]:
    candidate = existing
    final_write: HierarchyWrite = {'action': 'none'}
    soft_warnings: List[str] = []
    for instruction in instructions:
        try:
            next_write = resolve_type_hierarchy(
                candidate,
                instruction.present,
                instruction.hierarchy,
                'additive' if additive or instruction.soft_warning is not None else 'overwrite',
            )
        except TypeHierarchyError as error:
            if instruction.soft_warning is None:
                raise
            soft_warnings.append(instruction.soft_warning.format(reason=error.reason))
            continue
        if next_write['action'] == 'set':
            candidate = next_write['hierarchy']
            final_write = next_write
        elif next_write['action'] == 'delete':
            candidate = None
            final_write = next_write
    return final_write, soft_warnings


def _prepare_configuration_imports(
    folder: types.GirderModel,
    user: types.GirderUserModel,
    additive: bool,
) -> dict:
    """Resolve and stage every configuration file without changing dataset state."""
    fresh_folder = _fresh_folder_snapshot(folder)
    parent = crud.get_multicam_parent_folder(fresh_folder, user)
    fresh_parent = _fresh_folder_snapshot(parent) if parent is not None else None
    canonical = fresh_parent if fresh_parent is not None else fresh_folder
    config_results = []
    hierarchy_instructions = []
    parsed_json_items = {}
    item_files = {}

    _attachment_item_id, is_declared_sidecar = _declared_sidecar_predicate(folder, user)
    unprocessed_items = _unprocessed_data_items(folder)
    for item in unprocessed_items:
        file: Optional[types.GirderModel] = next(Item().childFiles(item), None)
        if file is None:
            raise RestException('Item had no associated files')
        item_files[str(item['_id'])] = file
        # A declared sidecar is frame metadata, never configuration; parsing it here
        # would let a frame-metadata.json contribute a typeHierarchy instruction.
        if is_declared_sidecar(item):
            continue
        if not file.get('exts') or file['exts'][-1] != 'json':
            continue
        results, warnings = _parse_data_item(item, file, configuration_only=True)
        if results is None:
            continue
        parsed_json_items[str(item['_id'])] = (file, results, warnings)
        if results['type'] == crud.FileType.COCO_JSON:
            coco_hierarchy = results.get('hierarchy')
            if coco_hierarchy is not None:
                hierarchy_instructions.append(
                    HierarchyInstruction(
                        True,
                        coco_hierarchy,
                        kwcoco.SUPERCATEGORY_INVALID_WARNING,
                    )
                )
            continue
        if results['type'] != crud.FileType.DIVE_CONF:
            continue
        meta = results['meta'] or {}
        hierarchy_instructions.append(
            HierarchyInstruction('typeHierarchy' in meta, meta.get('typeHierarchy'))
        )
        config_results.append(results)

    if (
        hierarchy_instructions
        and parent is None
        and crud.get_multicam_owner_folder(fresh_folder) is not None
    ):
        raise RestException(
            'Write access to the multicamera parent is required ' 'to change its type hierarchy.',
            code=403,
        )

    try:
        hierarchy_write, _ = _resolve_configuration_hierarchy(
            fromMeta(canonical, 'typeHierarchy'),
            hierarchy_instructions,
            additive,
        )
    except TypeHierarchyError as error:
        raise crud.hierarchy_rest_error(error) from error

    staged_meta = {}
    staged_parent_meta = {}
    working_dataset_info = fromMeta(fresh_folder, 'datasetInfo', {})
    working_parent_dataset_info = (
        fromMeta(fresh_parent, 'datasetInfo', {}) if fresh_parent is not None else {}
    )
    for results in config_results:
        meta = dict(results['meta'] or {})
        meta.pop('typeHierarchy', None)
        meta = resolve_imported_dataset_info(working_dataset_info, meta, additive)
        if 'datasetInfo' in meta:
            working_dataset_info = meta['datasetInfo']
        staged_meta.update(meta)
        if parent is not None:
            shared_meta = crud.pick_multicam_shared_mutable(results['meta'] or {})
            shared_meta.pop('typeHierarchy', None)
            shared_meta = resolve_imported_dataset_info(
                working_parent_dataset_info, shared_meta, additive
            )
            if 'datasetInfo' in shared_meta:
                working_parent_dataset_info = shared_meta['datasetInfo']
            staged_parent_meta.update(shared_meta)

    preflight_meta = apply_hierarchy_write(staged_meta, hierarchy_write)
    preflight_parent_meta = (
        apply_hierarchy_write(staged_parent_meta, hierarchy_write) if parent is not None else {}
    )
    if preflight_meta:
        models.MetadataMutable(**preflight_meta)
    if preflight_parent_meta:
        models.MetadataMutable(**preflight_parent_meta)

    return {
        'parent': parent,
        'unprocessed_items': unprocessed_items,
        'item_files': item_files,
        'parsed_json_items': parsed_json_items,
        'hierarchy_instructions': hierarchy_instructions,
        'additive': additive,
        'staged_meta': staged_meta,
        'staged_parent_meta': staged_parent_meta,
        'applied': False,
    }


def _apply_configuration_imports(
    folder: types.GirderModel,
    configuration_plan: dict,
) -> HierarchyWrite:
    if configuration_plan['applied']:
        return configuration_plan['hierarchy_write']
    parent = configuration_plan['parent']
    canonical = parent if parent is not None else folder
    fresh_canonical = _fresh_folder_snapshot(canonical)
    promoted_write: HierarchyWrite = {'action': 'none'}
    existing_hierarchy = fromMeta(fresh_canonical, 'typeHierarchy')
    if parent is not None:
        fresh_camera = _fresh_folder_snapshot(folder)
        camera_hierarchy = fromMeta(fresh_camera, 'typeHierarchy')
        if camera_hierarchy is not None:
            try:
                promoted_write = resolve_type_hierarchy(
                    existing_hierarchy,
                    True,
                    camera_hierarchy,
                    'additive',
                )
            except TypeHierarchyError as error:
                configuration_plan.setdefault('warnings', []).append(
                    f'Camera "{folder["name"]}" type hierarchy was skipped: {error.reason}'
                )
            else:
                if promoted_write['action'] == 'set':
                    existing_hierarchy = promoted_write['hierarchy']
    try:
        hierarchy_write, soft_warnings = _resolve_configuration_hierarchy(
            existing_hierarchy,
            configuration_plan['hierarchy_instructions'],
            configuration_plan['additive'],
        )
    except TypeHierarchyError as error:
        raise crud.hierarchy_rest_error(error) from error
    if soft_warnings:
        configuration_plan.setdefault('warnings', []).extend(soft_warnings)
    if hierarchy_write['action'] == 'none':
        hierarchy_write = promoted_write

    additive = configuration_plan['additive']
    staged_meta = dict(configuration_plan['staged_meta'])
    staged_parent_meta = (
        apply_hierarchy_write(configuration_plan['staged_parent_meta'], hierarchy_write)
        if parent is not None
        else {}
    )
    if parent is None:
        staged_meta = apply_hierarchy_write(staged_meta, hierarchy_write)
    hierarchy_mode: Literal['save', 'additive'] = 'additive' if additive else 'save'
    if staged_meta:
        crud_dataset.update_metadata(folder, staged_meta, False, hierarchy_mode=hierarchy_mode)
    if parent is not None:
        if staged_parent_meta:
            crud_dataset.update_metadata(
                parent, staged_parent_meta, False, hierarchy_mode=hierarchy_mode
            )
        if crud_dataset.remove_camera_type_hierarchy(folder):
            configuration_plan.setdefault('warnings', []).append(
                f'Removed a type hierarchy stored on camera {folder["name"]}; '
                'the type hierarchy for a multicamera dataset is stored on the parent.'
            )
    configuration_plan['hierarchy_write'] = hierarchy_write
    configuration_plan['applied'] = True
    return hierarchy_write


def process_items(
    folder: types.GirderModel,
    user: types.GirderUserModel,
    additive=False,
    additivePrepend='',
    set='',
    configuration_plan=None,
):
    """
    Discover unprocessed items in a dataset and process them by type in order of creation
    """
    if configuration_plan is None:
        configuration_plan = _prepare_configuration_imports(folder, user, additive)
    _apply_configuration_imports(folder, configuration_plan)
    unprocessed_items = configuration_plan['unprocessed_items']
    item_files = configuration_plan['item_files']
    parent = configuration_plan['parent']
    parsed_json_items = configuration_plan['parsed_json_items']

    attachment_item_id, is_declared_sidecar = _declared_sidecar_predicate(folder, user)
    aggregate_warnings: List[str] = list(configuration_plan.get('warnings', []))

    # This sweep is also the convergence point for headless writers (assetstore/S3 import),
    # where nobody picked these files and nothing can be corrected pre-upload. Attachment
    # ambiguity degrades to a warning rather than raising: a raise strips the folder's retry
    # marker and leaves fps at -1, so the folder would never converge.
    reserved_items = [
        item
        for item in unprocessed_items
        if frame_metadata.is_frame_metadata_source_name(item['name'])
    ]
    if attachment_item_id is None and len(reserved_items) > 1:
        # The extras stay in the folder, so the remedy is to delete all but one and
        # re-import; nothing is marked, so there is nothing to undo.
        reserved_names = ', '.join(item['name'] for item in reserved_items)
        aggregate_warnings.append(
            f'More than one metadata file was found in the dataset folder: {reserved_names}. '
            'None was attached; keep one and re-import.'
        )

    # Import the oldest annotation CSV and name the rest in a warning rather than failing.
    annotation_csv_items = [
        item
        for item in unprocessed_items
        if constants.csvRegex.search(item['name']) and not is_declared_sidecar(item)
    ]
    skipped_csv_items = annotation_csv_items[1:]
    if skipped_csv_items:
        skipped_names = ', '.join(item['name'] for item in skipped_csv_items)
        aggregate_warnings.append(
            f'Imported annotations from {annotation_csv_items[0]["name"]} only; '
            f'skipped {skipped_names}. A dataset imports one annotation CSV at a time.'
        )
        skipped_ids = {str(item['_id']) for item in skipped_csv_items}
        unprocessed_items = [
            item for item in unprocessed_items if str(item['_id']) not in skipped_ids
        ]

    # image_map (extension-stripped media stems) feeds the VIAME parser and only exists for
    # image-sequence folders. Skip the media walk entirely when only sidecars are present:
    # a declared sidecar is classified by name and never joined here.
    image_map = None
    if fromMeta(folder, constants.TypeMarker) == constants.ImageSequenceType and any(
        not is_declared_sidecar(item) for item in unprocessed_items
    ):
        image_map = crud.valid_image_names_dict(crud.valid_images(folder, user))

    auxiliary = None
    for item in unprocessed_items:
        file = item_files[str(item['_id'])]

        # The single classification point: a declared sidecar is identified by attachment
        # identity or reserved name and never reaches the annotation classifier. Keep it in
        # the dataset folder for read-time discovery and mark it processed so it is not
        # re-swept, but never import it as annotations, move it, or remove it.
        if is_declared_sidecar(item):
            if str(item['_id']) == attachment_item_id and not fromMeta(
                folder, constants.MetadataFileItemIdMarker
            ):
                _attach_swept_sidecar(folder, item)
            # Tag for Girder UI; folder locator alone is not visible on the item.
            item['meta'][constants.FrameMetadataFileMarker] = 'true'
            item['meta'][constants.ProcessedMarker] = True
            Item().save(item)
            aggregate_warnings.append(_frame_metadata_kept_warning(file['name']))
            continue

        # Configuration staging already parsed and validated every JSON item; reuse that
        # result so an import is not parsed twice and cannot disagree with the plan.
        cached = parsed_json_items.get(str(item['_id']))
        if cached is not None:
            _cached_file, results, warnings = cached
        else:
            results, warnings = _parse_data_item(item, file, image_map)
        if warnings:
            aggregate_warnings += warnings

        if auxiliary is None:
            auxiliary = crud.get_or_create_auxiliary_folder(folder, user)
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
                set=set,
            )
        if results['attributes']:
            crud.saveImportAttributes(folder, results['attributes'], user)
        if results['meta'] and results['type'] != crud.FileType.DIVE_CONF:
            meta = resolve_imported_dataset_info(
                fromMeta(folder, 'datasetInfo', {}), results['meta'], additive
            )
            crud_dataset.update_metadata(folder, meta, False)
        # Mutable config (styling, thresholds, attributes, ...) is loaded by the
        # viewer from the multicam parent's metadata, so an import targeted at
        # one camera must update the parent too (mirrors desktop dataFileImport).
        if parent is not None:
            if results['attributes']:
                crud.saveImportAttributes(parent, results['attributes'], user)
            shared_meta = (
                crud.pick_multicam_shared_mutable(results['meta'] or {})
                if results['type'] != crud.FileType.DIVE_CONF
                else {}
            )
            if shared_meta:
                parent_meta = resolve_imported_dataset_info(
                    fromMeta(parent, 'datasetInfo', {}), shared_meta, additive
                )
                crud_dataset.update_metadata(parent, parent_meta, False)
    return aggregate_warnings


def postprocess(
    user: types.GirderUserModel,
    dsFolder: types.GirderModel,
    skipJobs: bool,
    skipTranscoding=False,
    additive=False,
    additivePrepend='',
    set='',
) -> dict:
    return _postprocess(
        user,
        dsFolder,
        skipJobs,
        skipTranscoding,
        additive,
        additivePrepend,
        set,
    )


def _postprocess(
    user: types.GirderUserModel,
    dsFolder: types.GirderModel,
    skipJobs: bool,
    skipTranscoding=False,
    additive=False,
    additivePrepend='',
    set='',
) -> dict:
    """
    Post-processing to be run after media/annotation import

    When skipJobs=False, the following may run as jobs:
        Transcoding of Video
        Transcoding of Images
        Conversion of KPF annotations into track JSON
        Extraction and upload of zip files

    In either case, the following may run synchronously:
        Conversion of CSV annotations into track JSON
    Returns:
        dict: Contains 'folder' (the processed folder) and 'job_ids' (list of created job IDs)
    """
    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)
    isClone = dsFolder.get(constants.ForeignMediaIdMarker, None) is not None
    # Track job IDs for batch processing
    created_job_ids = []

    # Validate user-supplied metadata fields are present
    if fromMeta(dsFolder, constants.FPSMarker) is None:
        raise RestException(f'{constants.FPSMarker} missing from metadata')
    if fromMeta(dsFolder, constants.TypeMarker) is None:
        raise RestException(f'{constants.TypeMarker} missing from metadata')

    configuration_plan = _prepare_configuration_imports(dsFolder, user, additive)

    # Folder-shape validation runs before any configuration write so a rejected
    # postprocess leaves the dataset untouched.
    zipItems: list = []
    if not skipJobs and not isClone:
        zipItems = list(
            Folder().childItems(
                dsFolder,
                filters={"lowerName": {"$regex": constants.zipRegex}},
            )
        )
        if len(zipItems) > 1:
            raise RestException('There are multiple zip files in the folder.')
        if zipItems and len(list(Folder().childItems(dsFolder))) > 1:
            raise RestException('There are multiple files besides a zip, cannot continue')

    configuration_hierarchy_write = _apply_configuration_imports(dsFolder, configuration_plan)

    # Persist default confidence filter without a full stale meta write. Async
    # convert_video (esp. skipTranscoding) can finish during CSV import and set
    # annotate / originalFps / ffprobe_info; a later Folder().save of an old
    # in-memory doc would wipe those keys.
    crud.refresh_folder_document(dsFolder)
    if constants.ConfidenceFiltersMarker not in dsFolder.setdefault('meta', {}):
        dsFolder['meta'][constants.ConfidenceFiltersMarker] = {'default': 0.1}
        Folder().save(dsFolder)

    if not skipJobs and not isClone:
        token = Token().createToken(user=user, days=2)

        # extract ZIP Files if not already completed
        for item in zipItems:
            convert_params = {
                'user_id': str(user["_id"]),
                'user_login': str(user["login"]),
                'input_folder': str(dsFolder["_id"]),
            }
            newjob = tasks.extract_zip.apply_async(
                queue=_get_queue_name(user),
                kwargs=dict(
                    folderId=str(item["folderId"]),
                    itemId=str(item["_id"]),
                    user_id=str(user["_id"]),
                    user_login=str(user["login"]),
                    additive=additive,
                    girder_job_title=(f"Extracting {item['name']} to folder {dsFolder['name']}"),
                    girder_client_token=str(token["_id"]),
                    girder_job_type="private" if job_is_private else "convert",
                ),
            )
            job = _persist_async_job_metadata(
                newjob,
                **{
                    constants.JOBCONST_PRIVATE_QUEUE: job_is_private,
                    constants.JOBCONST_DATASET_ID: str(item["folderId"]),
                    constants.JOBCONST_PARAMS: convert_params,
                    constants.JOBCONST_CREATOR: str(user['_id']),
                },
            )
            created_job_ids.append(job['_id'])
            return {
                'folder': dsFolder,
                'job_ids': created_job_ids,
                'configurationHierarchyWrite': configuration_hierarchy_write,
            }

        # transcode VIDEO if necessary
        videoItems = Folder().childItems(
            dsFolder, filters={"lowerName": {"$regex": constants.videoRegex}}
        )

        for item in videoItems:
            convert_params = {
                'user_id': str(user["_id"]),
                'user_login': str(user["login"]),
                'input_folder': str(dsFolder["_id"]),
            }
            newjob = tasks.convert_video.apply_async(
                queue=_get_queue_name(user),
                kwargs=dict(
                    folderId=str(item["folderId"]),
                    itemId=str(item["_id"]),
                    user_id=str(user["_id"]),
                    user_login=str(user["login"]),
                    skip_transcoding=skipTranscoding,
                    girder_job_title=(f"Converting {dsFolder['name']} to a web friendly format"),
                    girder_client_token=str(token["_id"]),
                    girder_job_type="private" if job_is_private else "convert",
                ),
            )
            job = _persist_async_job_metadata(
                newjob,
                **{
                    constants.JOBCONST_PRIVATE_QUEUE: job_is_private,
                    constants.JOBCONST_DATASET_ID: dsFolder["_id"],
                    constants.JOBCONST_PARAMS: convert_params,
                    constants.JOBCONST_CREATOR: str(user['_id']),
                },
            )
            created_job_ids.append(job['_id'])

        # transcode IMAGERY if necessary
        imageItems = Folder().childItems(
            dsFolder, filters={"lowerName": {"$regex": constants.imageRegex}}
        )
        safeImageItems = Folder().childItems(
            dsFolder, filters={"lowerName": {"$regex": constants.safeImageRegex}}
        )
        largeImageItems = Folder().childItems(
            dsFolder, filters={"lowerName": {"$regex": constants.largeImageRegEx}}
        )

        if imageItems.count() > safeImageItems.count():
            convert_params = {
                'user_id': str(user["_id"]),
                'user_login': str(user["login"]),
                'input_folder': str(dsFolder["_id"]),
            }
            newjob = tasks.convert_images.apply_async(
                queue=_get_queue_name(user),
                kwargs=dict(
                    folderId=dsFolder["_id"],
                    user_id=str(user["_id"]),
                    user_login=str(user["login"]),
                    girder_client_token=str(token["_id"]),
                    girder_job_title=(f"Converting {dsFolder['name']} to a web friendly format"),
                    girder_job_type="private" if job_is_private else "convert",
                ),
            )
            job = _persist_async_job_metadata(
                newjob,
                **{
                    constants.JOBCONST_PRIVATE_QUEUE: job_is_private,
                    constants.JOBCONST_DATASET_ID: dsFolder["_id"],
                    constants.JOBCONST_PARAMS: convert_params,
                    constants.JOBCONST_CREATOR: str(user['_id']),
                },
            )
            created_job_ids.append(job['_id'])

        elif imageItems.count() > 0 or largeImageItems.count() > 0:
            # Safe/web images need annotate now; convert_images sets it when it runs.
            crud.refresh_folder_document(dsFolder)
            dsFolder.setdefault('meta', {})[constants.DatasetMarker] = True
            Folder().save(dsFolder)

    aggregate_warnings = process_items(
        dsFolder,
        user,
        additive,
        additivePrepend,
        set,
        configuration_plan=configuration_plan,
    )
    # Image sequences start at fps=-1 (auto). CSV import may have set a value;
    # otherwise default to 1. convert_images also resolves, but safe-image folders
    # skip that job and need this finalize step.
    crud.refresh_folder_document(dsFolder)
    media_type = fromMeta(dsFolder, constants.TypeMarker)
    if media_type in (constants.ImageSequenceType, constants.LargeImageType):
        requested_fps = fromMeta(dsFolder, constants.FPSMarker)
        new_fps = choose_annotation_fps(requested_fps)
        if requested_fps != new_fps:
            dsFolder['meta'][constants.FPSMarker] = new_fps
            Folder().save(dsFolder)
    return {
        'folder': dsFolder,
        'warnings': aggregate_warnings,
        'job_ids': created_job_ids,
        'configurationHierarchyWrite': configuration_hierarchy_write,
    }


def convert_large_image(
    user: types.GirderUserModel,
    dsFolder: types.GirderModel,
):
    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)
    isClone = dsFolder.get(constants.ForeignMediaIdMarker, None) is not None

    if not isClone:
        token = Token().createToken(user=user, days=2)
        convert_params = {
            'user_id': str(user["_id"]),
            'user_login': str(user["login"]),
            'input_folder': str(dsFolder["_id"]),
        }
        newjob = tasks.convert_large_images.apply_async(
            queue=_get_queue_name(user),
            kwargs=dict(
                folderId=dsFolder["_id"],
                user_id=str(user["_id"]),
                user_login=str(user["login"]),
                girder_client_token=str(token["_id"]),
                girder_job_title=(f"Converting {dsFolder['name']} to a web friendly format"),
                girder_job_type="private" if job_is_private else "convert",
            ),
        )
        job = _persist_async_job_metadata(
            newjob,
            **{
                constants.JOBCONST_PRIVATE_QUEUE: job_is_private,
                constants.JOBCONST_DATASET_ID: dsFolder["_id"],
                constants.JOBCONST_PARAMS: convert_params,
                constants.JOBCONST_CREATOR: str(user['_id']),
            },
        )
        Notification().createNotification(
            type='job_status',
            data=job,
            user=user,
            expires=datetime.now() + timedelta(seconds=30),
        )
