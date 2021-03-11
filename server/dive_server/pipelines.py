from typing import Dict

from girder.exceptions import RestException
from girder.models.folder import Folder
from girder.models.setting import Setting
from girder.models.user import User

from dive_server.constants import (
    SETTINGS_CONST_JOBS_CONFIGS,
    TrainedPipelineCategory,
    TrainedPipelineMarker,
)
from dive_utils.types import AvailableJobSchema, PipelineCategory, PipelineDescription


def _load_dynamic_pipelines(user: User) -> Dict[str, PipelineCategory]:
    """Add any additional dynamic pipelines to the existing pipeline list."""

    pipelines: Dict[str, PipelineCategory] = {}
    pipelines[TrainedPipelineCategory] = {"pipes": [], "description": ""}
    pipelines[TrainedPipelineCategory]["pipes"] = [
        {
            "name": folder["name"],
            "type": TrainedPipelineCategory,
            # TODO: the string 'detector.pipe' comes from a convention
            # within VIAME that may not always be true.
            "pipe": "detector.pipe",
            "folderId": str(folder["_id"]),
        }
        for folder in Folder().findWithPermissions(
            query={f"meta.{TrainedPipelineMarker}": True},
            user=user,
        )
    ]
    return pipelines


def load_pipelines(user: User) -> Dict[str, PipelineCategory]:
    """Load all static and dynamic pipelines"""
    static_job_configs: AvailableJobSchema = (
        Setting().get(SETTINGS_CONST_JOBS_CONFIGS) or {}
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
        matchs = [pipe for pipe in category_pipes if pipe["pipe"] == pipeline["pipe"]]
        if len(matchs) != 1:
            raise missing_exception
    except KeyError:
        raise missing_exception
