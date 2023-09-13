import os
from pathlib import Path
import re
from typing import Dict, List, Optional

from dive_utils.constants import TrainingModelExtensions
from dive_utils.types import (
    AvailableJobSchema,
    PipelineCategory,
    PipelineDescription,
    TrainingConfigurationSummary,
    TrainingModelDescription,
)

DefaultTrainingConfiguration = "train_detector_default.viame_csv.conf"
AllowedTrainingConfigs = r".*\.viame_csv\.conf$"
DisallowedTrainingConfigs = r".*(_nf|\.continue)\.viame_csv\.conf$"
AllowedStaticPipelines = r"^detector_.+|^tracker_.+|^utility_.+|^generate_.+"

DisallowedStaticPipelines = (
    # Remove utilities pipes which hold no meaning in web
    r".*local.*|"
    r".*hough.*|"
    r".*_svm_models\.pipe|"
    r"detector_extract_chips\.pipe|"
    # Remove tracker pipelines which hold no meaning in web
    r"tracker_stabilized_iou\.pipe|"
    r"tracker_short_term\.pipe|"
    # Remove seal and sea lion specialized pipelines un-runnable in web
    r"detector_arctic_.*fusion.*\.pipe|"
    r".*[2|3]-cam\.pipe"
)


def load_static_pipelines(search_path: Path) -> Dict[str, PipelineCategory]:
    pipedict: Dict[str, PipelineCategory] = {}

    pipelist = [
        path.name
        for path in search_path.glob("./*.pipe")
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
        print(f"Discovered pipe {pipe_info}")
        if pipe_type in pipedict:
            pipedict[pipe_type]["pipes"].append(pipe_info)
        else:
            pipedict[pipe_type] = {"pipes": [pipe_info], "description": ""}

    return pipedict


def load_training_configurations(search_path: Path) -> TrainingConfigurationSummary:
    configurations: List[str] = []
    default_config: Optional[str] = None
    pipes = sorted(
        search_path.glob("./*.conf"), key=lambda x: (x.name == DefaultTrainingConfiguration, x)
    )
    for pipe in pipes:
        pipe_name = pipe.name
        configurations.append(pipe_name)
        print(f"Discovered training {pipe_name}")
        if pipe_name == DefaultTrainingConfiguration:
            default_config = pipe_name

    # Filter out stuff that doesn't match allowed patterns
    configurations = [
        c
        for c in configurations
        if re.match(AllowedTrainingConfigs, c) and not re.match(DisallowedTrainingConfigs, c)
    ]

    return {
        "configs": configurations,
        "default": default_config or pipe_name,
    }


def load_training_models(search_path: Path) -> Dict[str, TrainingModelDescription]:
    model_dict: Dict[str, TrainingModelDescription] = {}

    # Use a list comprehension and glob to find matching files
    matching_models = []
    for root, _dirs, files in os.walk(search_path):
        for file in files:
            if file.endswith(
                TrainingModelExtensions
            ):  # The arg can be a tuple of suffixes to look for
                matching_models.append(os.path.join(root, file))

    for match in matching_models:
        print(f"Discovered Model: {match}")
        model_info: TrainingModelDescription = {
            "name": os.path.basename(match),
            "path": str(match),
            "type": Path(match).suffix,
            "folderId": None,
        }
        model_dict[Path(match).stem] = model_info

    return model_dict


def discover_configs(search_path: Path) -> AvailableJobSchema:
    return {
        'pipelines': load_static_pipelines(search_path),
        'training': load_training_configurations(search_path),
        'models': load_training_models(search_path),
    }
