from typing import Any, Dict, List, Optional

from typing_extensions import TypedDict

__all__ = [
    "GirderModel",
    "PipelineDescription",
    "PipelineJob",
    "PipelineCategory",
]


class GirderModel(TypedDict):
    name: str
    _id: str


class PipelineDescription(TypedDict):
    """Describes a pipeline for running on datasets."""

    name: str  # friendly name
    type: str  # indicates whether this is a dynamic pipe.
    pipe: str  # unmodified pipe file name

    # If the pipeline is stored in girder, this is
    # the ID of the folder containing the pipeline,
    folderId: Optional[str]


class PipelineJob(TypedDict):
    """Describes the parameters for running a pipeline on a dataset."""

    pipeline: PipelineDescription
    input_folder: str
    input_type: str
    output_folder: str
    pipeline_input: Optional[GirderModel]


class TrainingConfigurationSummary(TypedDict):
    configs: List[str]
    default: Optional[str]


class PipelineCategory(TypedDict):
    pipes: List[PipelineDescription]
    description: str


class AvailableJobSchema(TypedDict):
    pipelines: Dict[str, PipelineCategory]
    training: TrainingConfigurationSummary
