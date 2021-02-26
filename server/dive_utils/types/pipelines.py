from typing import List, Optional

from typing_extensions import TypedDict

__all__ = ["PipelineDescription", "PipelineJob", "PipelineCategory"]


class PipelineDescription(TypedDict):
    """Describes a pipeline for running on datasets."""

    name: str
    type: str
    pipe: str

    # If the pipeline is stored in girder, this is
    # the ID of the folder containing the pipeline,
    folderId: Optional[str]


class PipelineJob(TypedDict):
    """Describes the parameters for running a pipeline on a dataset."""

    pipeline: PipelineDescription
    input_folder: str
    input_type: str
    output_folder: str


class PipelineCategory(TypedDict):
    pipes: List[PipelineDescription]
    description: str
