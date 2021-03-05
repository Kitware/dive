import os
from pathlib import Path
import re
from typing import List, Dict

from dive_utils.types import (
    AvailableJobSchema,
    PipelineCategory,
    PipelineDescription,
    TrainingConfiguration,
    TrainingConfigurationSummary,
)

DefaultTrainingConfiguration = "train_netharn_cascade.viame_csv.conf"
AllowedTrainingConfigs = r".*\.viame_csv\.conf$"
AllowedStaticPipelines = r"^detector_.+|^tracker_.+|^generate_.+"
DisallowedStaticPipelines = (
    r".*local.*|detector_svm_models\.pipe|tracker_svm_models\.pipe"
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

        if pipe_type in pipedict:
            pipedict[pipe_type]["pipes"].append(pipe_info)
        else:
            pipedict[pipe_type] = {"pipes": [pipe_info], "description": ""}

    return pipedict


def load_training_configurations(search_path: Path) -> TrainingConfigurationSummary:
    configurations: List[TrainingConfiguration] = []
    default_config: TrainingConfiguration

    for pipe in search_path.glob("./*.conf"):
        nameparts = pipe.name.replace(".pipe", "").split("_")
        training_conf: TrainingConfiguration = {
            'name': " ".join(nameparts),
            'pipe': pipe.name,
        }
        configurations.append(training_conf)
        if training_conf['pipe'] == DefaultTrainingConfiguration:
            default_config = training_conf

    # Filter out stuff that doesn't match allowed patterns
    configurations = [
        c for c in configurations if re.match(AllowedTrainingConfigs, c['name'])
    ]

    return {
        "configs": configurations,
        "default": default_config,
    }


def discover_configs(search_path: Path) -> AvailableJobSchema:
    return {
        'pipelines': load_static_pipelines(search_path),
        'training': load_training_configurations(search_path),
    }
