from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel
from typing_extensions import NotRequired, TypedDict

__all__ = [
    "Attributes",
    "DatasetInfo",
    "DiveParam",
    "GirderModel",
    "PipelineDescription",
    "PipelineParams",
    "PipelineRuntimeParams",
    "PipelineJob",
    "PipelineCategory",
    "PipeMetadata",
    "Warnings",
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


class TrainingModelDescription(BaseModel):
    name: str  # fileanme
    type: str  # extension for the type

    # might not be in the root so we need a full path
    path: Optional[str]
    # If the model is stored in girder, this is
    # the ID of the folder containing the model
    folderId: Optional[str]


class TrainingModelTuneArgs(TrainingModelDescription):
    """Update schema for mutable metadata fields"""

    class Config:
        extra = 'forbid'


class DiveParam(TypedDict):
    label: str
    type: str
    type_props: list[str]
    key: str
    default: str


class PipeMetadata(TypedDict):
    description: Optional[str]
    inputType: Optional[str]
    outputType: Optional[str]
    diveParams: Optional[list[DiveParam]]
    requiresCalibration: Optional[bool]
    # KWIVER config key (e.g. "stabilizer:flight_log") that the dataset's optional
    # metadata file is bound to at run time, parsed from `# Metadata File: <key>`.
    metadataFileKey: NotRequired[Optional[str]]


class PipelineDescription(TypedDict):
    """Describes a pipeline for running on datasets."""

    name: str  # friendly name
    type: str  # indicates whether this is a dynamic pipe.
    pipe: str  # unmodified pipe file name
    metadata: Optional[PipeMetadata]  # some metadata about the pipeline

    # If the pipeline is stored in girder, this is
    # the ID of the folder containing the pipeline,
    folderId: Optional[str]


class PipelineRuntimeParams(TypedDict, total=False):
    frameRange: Optional[Tuple[int, int]]


class PipelineParams(TypedDict, total=False):
    kwiverParams: Dict[str, str]
    runtimeParams: PipelineRuntimeParams


class MulticamCameraJob(TypedDict):
    """Per-camera folder info for a multicam pipeline job."""

    name: str
    folder_id: str
    media_type: str
    input_revision: NotRequired[Optional[int]]


class PipelineJob(TypedDict):
    """Describes the parameters for running a pipeline on a dataset."""

    pipeline: PipelineDescription
    input_folder: str  # dataset folder id
    input_type: str  # video, image-sequence, etc.
    input_revision: Optional[int]  # A revision ID is included if the pipeline needs input
    output_folder: str  # Where to upload results
    user_id: str  # user id who started the job
    user_login: str  # login of user who started the kjob
    force_transcoded: Optional[bool]
    runtime_params: Optional[PipelineRuntimeParams]
    kwiver_params: Optional[Dict[str, str]]
    # Optional per-dataset metadata file handed to opt-in pipelines. The item id
    # points at a Girder item in the dataset folder; the key is the KWIVER config
    # target declared by the pipe's `# Metadata File:` header.
    metadata_file_item_id: NotRequired[Optional[str]]
    metadata_file_key: NotRequired[Optional[str]]


class MulticamPipelineJob(PipelineJob, total=False):
    """Pipeline job fields set when running stereo/multicam pipelines on a multi dataset."""

    multicam_cameras: List[MulticamCameraJob]
    multicam_default_display: str
    calibration_item_id: Optional[str]
    multicam_requires_input: bool


class TrainingJob(TypedDict):
    """Describes the paramteers for running training"""

    results_folder_id: str  # Where to upload the outputs
    dataset_input_list: List[Tuple[str, int]]  # Tuples of (dataset_id, revision_id)
    pipeline_name: str  # Name of the new pipeline to train
    config: str  # Name of the training configuration file to use.
    annotated_frames_only: bool  # Train on only the annotated frames
    label_txt: Optional[str]  # Contents of a labels.txt to include in training
    model: Optional[TrainingModelTuneArgs]  # Model for fine-tune training
    user_id: str  # user id who started the job
    user_login: str  # login of user who started the kjob
    force_transcoded: Optional[bool]  # Force using the transcoded version


class ExportTrainedPipelineJob(TypedDict):
    """Describes the parameters for exporting a pipeline"""

    input_folder: str  # Where the model to export is
    output_folder: str  # Where to upload results
    output_name: str  # Name of the exported file
    user_id: str  # user id who started the job
    user_login: str  # login of user who started the job


class TrainingConfigurationSummary(TypedDict):
    configs: List[str]
    default: Optional[str]


class PipelineCategory(TypedDict):
    pipes: List[PipelineDescription]
    description: str


class AvailableJobSchema(TypedDict):
    pipelines: Dict[str, PipelineCategory]
    training: TrainingConfigurationSummary
    models: Dict[str, TrainingModelDescription]


class DIVEAnnotationSchema(TypedDict):
    tracks: Dict[str, dict]
    groups: Dict[str, dict]
    version: int


class CameraCalibration(TypedDict, total=False):
    cx: float
    cy: float
    fx: float
    fy: float
    k1: float
    k2: float
    k3: float
    p1: float
    p2: float
    rmsError: float


class DatasetStereoCalibration(TypedDict):
    R: List[float]
    T: List[float]
    calibrations: Dict[str, CameraCalibration]
    gridHeight: NotRequired[int]
    gridWidth: NotRequired[int]
    imageHeight: NotRequired[int]
    imageWidth: NotRequired[int]
    squareSize: NotRequired[float]
    rmsError: NotRequired[float]


class DatasetCalibrationResult(TypedDict):
    # `calibration` is absent when the stored file isn't a parseable JSON
    # camera-rig (e.g. an .npz); the file name is still reported via `jsonPath`.
    calibration: NotRequired[DatasetStereoCalibration]
    itemId: NotRequired[str]
    jsonItemId: NotRequired[str]
    originalName: NotRequired[str]
    jsonPath: NotRequired[str]
    path: NotRequired[str]
    # Set when a background conversion job failed for the linked source file.
    conversionError: NotRequired[str]


# Attribute metadata discovered while deserializing annotations, keyed by attribute name.
Attributes = Dict[str, Dict[str, Any]]

# Human-readable warnings surfaced during an import.
Warnings = List[str]

# Per-dataset station metadata (the COCO ``info.dive_dataset_info`` block).
DatasetInfo = Dict[str, Any]
