from typing import Any, List, Optional, Dict
from typing_extensions import TypedDict

__all__ = [
    "GirderMode",
    "PipelineDescription",
    "PipelineJob",
    "PipelineCategory",
]


class GirderModel(TypedDict):
    _id: str
    name: str
    meta: Dict[str, Any]


class PipelineDescription(TypedDict):
    """Describes a pipeline for running on datasets."""

    name: str  # friendly name
    type: str  # indicates whether this is a dynamic pipe.
    pipe: Optional[str]  # unmodified pipe file name

    # If the pipeline is stored in girder, this is
    # the ID of the folder containing the pipeline,
    folderId: Optional[str]


class PipelineJob(TypedDict):
    """Describes the parameters for running a pipeline on a dataset."""

    pipeline: PipelineDescription
    input_folder: str
    input_type: str
    output_folder: str


class TrainingConfiguration(TypedDict):
    pipe: str  # unmodified pipe file name
    name: str  # friendly name


class TrainingConfigurationSummary(TypedDict):
    configs: List[TrainingConfiguration]
    default: Optional[TrainingConfiguration]


class TrainingJob(TypedDict):
    """Describes the parameters for running a training job"""

    new_pipeline_name: str
    config_pipeline: TrainingConfiguration
    results_folder: GirderModel
    source_folder_list: List[GirderModel]
    groundtruth_list: List[GirderModel]


class PipelineCategory(TypedDict):
    pipes: List[PipelineDescription]
    description: str


class UpgradeJob(TypedDict):
    force: bool
    urls: List[str]


class AvailableJobSchema(TypedDict):
    pipelines: Dict[str, PipelineCategory]
    training: TrainingConfigurationSummary
