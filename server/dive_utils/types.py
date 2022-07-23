from typing import Any, Dict, List, Optional, Tuple

from typing_extensions import TypedDict

__all__ = [
    "GirderModel",
    "PipelineDescription",
    "PipelineJob",
    "PipelineCategory",
]


class GirderModel(TypedDict):
    """A superset of all the common properties of a girder model"""

    _id: str
    baseParentType: str
    baseParentId: str
    created: str
    creatorId: str
    description: str
    meta: Dict[str, Any]
    name: str
    parentCollection: str
    parentId: str
    public: bool
    size: int
    updated: str
    exts: str


class AssetstoreModel(GirderModel):
    prefix: str
    bucket: str


class GirderUserModel(GirderModel):
    login: str


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
    input_folder: str  # dataset folder id
    input_type: str  # video, image-sequence, etc.
    input_revision: Optional[int]  # A revision ID is included if the pipeline needs input
    output_folder: str  # Where to upload results
    user_id: str  # user id who started the job
    user_login: str  # login of user who started the kjob


class TrainingJob(TypedDict):
    """Describes the paramteers for running training"""

    results_folder_id: str  # Where to upload the outputs
    dataset_input_list: List[Tuple[str, int]]  # Tuples of (dataset_id, revision_id)
    pipeline_name: str  # Name of the new pipeline to train
    config: str  # Name of the training configuration file to use.
    annotated_frames_only: bool  # Train on only the annotated frames
    label_txt: Optional[str]  # Contents of a labels.txt to include in training
    user_id: str  # user id who started the job
    user_login: str  # login of user who started the kjob


class TrainingConfigurationSummary(TypedDict):
    configs: List[str]
    default: Optional[str]


class PipelineCategory(TypedDict):
    pipes: List[PipelineDescription]
    description: str


class AvailableJobSchema(TypedDict):
    pipelines: Dict[str, PipelineCategory]
    training: TrainingConfigurationSummary


class DIVEAnnotationSchema(TypedDict):
    tracks: Dict[str, dict]
    groups: Dict[str, dict]
    version: int
