import copy
import re
import os
from typing import Dict, List, Optional

from girder.models.folder import Folder

from dive_server.constants import TrainedPipelineCategory, TrainedPipelineMarker
from dive_utils.types import PipelineCategory, PipelineDescription


def load_dynamic_pipelines(user: Optional[Dict] = None) -> Dict[str, PipelineCategory]:
    """Add any additional dynamic pipelines to the existing pipeline list."""

    pipelines: Dict[str, PipelineCategory] = {}
    pipelines[TrainedPipelineCategory] = {"pipes": [], "description": ""}
    pipelines[TrainedPipelineCategory]["pipes"] = [
        {
            "name": folder["name"],
            "type": TrainedPipelineCategory,
            "pipe": None,
            "folderId": str(folder["_id"]),
        }
        for folder in Folder().findWithPermissions(
            query={f"meta.{TrainedPipelineMarker}": True},
            user=user,
        )
    ]
    return pipelines
