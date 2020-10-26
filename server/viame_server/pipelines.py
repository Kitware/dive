import copy
import re
from typing import Dict, List, Optional

from girder.models.folder import Folder
from typing_extensions import TypedDict

from viame_server.constants import TrainedPipelineCategory, TrainedPipelineMarker
from viame_server.utils import get_static_pipelines_path

AllowedStaticPipelines = r"^detector_.+|^tracker_.+|^generate_.+"
DisallowedStaticPipelines = (
    r".*local.*|detector_svm_models.pipe|tracker_svm_models.pipe"
)


class PipelineDescription(TypedDict):
    """Describes a pipeline for running on datasets."""

    name: str
    type: str
    pipe: str

    # If the pipeline is stored in girder, this is
    # the ID of the folder containing the pipeline,
    folderId: Optional[str]


class PipelineCategory(TypedDict):
    pipes: List[PipelineDescription]
    description: str


Pipelines = Dict[str, PipelineCategory]


def load_static_pipelines() -> Pipelines:
    """Return the static pipelines."""

    static_pipelines_path = get_static_pipelines_path()
    pipedict: Pipelines = {}
    pipelist = [
        path.name
        for path in static_pipelines_path.glob("./*.pipe")
        if re.match(AllowedStaticPipelines, path.name)
        and not re.match(DisallowedStaticPipelines, path.name)
    ]

    for pipe in pipelist:
        pipe_type, *nameparts = pipe.replace(".pipe", "").split("_")
        pipe_info: PipelineDescription = {
            "name": " ".join(nameparts),
            "type": pipe_type,
            "pipe": pipe,
            "folderId": None,
        }

        if pipe_type in pipedict:
            pipedict[pipe_type]["pipes"].append(pipe_info)
        else:
            pipedict[pipe_type] = {"pipes": [pipe_info], "description": ""}

    return pipedict


def load_pipelines(static_pipelines: Pipelines) -> Pipelines:
    """Add any additional dynamic pipelines to the existing static pipeline list."""
    pipelines = copy.deepcopy(static_pipelines)
    trained_pipelines: List[PipelineDescription] = [
        {
            "name": folder["name"],
            "type": TrainedPipelineCategory,
            "pipe": "detector.pipe",
            "folderId": str(folder["_id"]),
        }
        for folder in Folder().find({f"meta.{TrainedPipelineMarker}": True})
    ]

    if not len(trained_pipelines):
        return pipelines

    if TrainedPipelineCategory not in pipelines:
        pipelines[TrainedPipelineCategory] = {"pipes": [], "description": ""}

    pipelines[TrainedPipelineCategory]["pipes"].extend(trained_pipelines)

    return pipelines
