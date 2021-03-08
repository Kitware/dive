from typing import Dict

from girder.models.folder import Folder
from girder.models.model_base import Model

from dive_server.constants import TrainedPipelineCategory, TrainedPipelineMarker
from dive_utils.types import PipelineCategory

<<<<<<< HEAD
=======
AllowedStaticPipelines = r"^detector_.+|^tracker_.+|^utility_.+|^generate_.+"
DisallowedStaticPipelines = (
    r".*local.*|detector_svm_models\.pipe|tracker_svm_models\.pipe"
)
>>>>>>> main

def load_dynamic_pipelines(user: Model) -> Dict[str, PipelineCategory]:
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
