from typing import Dict

from girder.exceptions import RestException
from girder.models.folder import Folder
from girder.models.setting import Setting
from girder.models.user import User

from dive_tasks.tasks import EMPTY_JOB_SCHEMA
from dive_utils import TRUTHY_META_VALUES
from dive_utils.constants import (
    SETTINGS_CONST_JOBS_CONFIGS,
    TrainedPipelineCategory,
    TrainedPipelineMarker,
)
from dive_utils.types import AvailableJobSchema, PipelineCategory, PipelineDescription


def _load_dynamic_pipelines(user: User) -> Dict[str, PipelineCategory]:
    """Add any additional dynamic pipelines to the existing pipeline list."""

    pipelines: Dict[str, PipelineCategory] = {}
    pipelines[TrainedPipelineCategory] = {"pipes": [], "description": ""}
    for folder in Folder().findWithPermissions(
        query={f"meta.{TrainedPipelineMarker}": {'$in': TRUTHY_META_VALUES}},
        user=user,
    ):
        pipename = None
        for item in Folder().childItems(folder):
            if item['name'].endswith('.pipe'):
                pipename = item['name']
        if pipename is not None:
            pipelines[TrainedPipelineCategory]["pipes"].append(
                {
                    "name": folder["name"],
                    "type": TrainedPipelineCategory,
                    "pipe": pipename,
                    "folderId": str(folder["_id"]),
                }
            )
    return pipelines


def load_pipelines(user: User) -> Dict[str, PipelineCategory]:
    """Load all static and dynamic pipelines"""
    static_job_configs: AvailableJobSchema = (
        Setting().get(SETTINGS_CONST_JOBS_CONFIGS) or EMPTY_JOB_SCHEMA
    )
    static_pipelines = static_job_configs.get('pipelines', {})
    dynamic_pipelines = _load_dynamic_pipelines(user)
    static_pipelines.update(dynamic_pipelines)
    return static_pipelines


def verify_pipe(user: User, pipeline: PipelineDescription):
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
