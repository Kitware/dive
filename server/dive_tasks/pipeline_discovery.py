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


def get_static_pipelines_paths() -> List[Path]:
    """
    Find all the places there might be static pipelines on disk
    """
    # env_pipelines_paths = os.getenv("VIAME_PIPELINES_PATH", "").split(",")
    env_pipelines_paths = ['/opt/noaa/viame/configs/pipelines']
    if len(env_pipelines_paths) == 0:
        raise Exception(
            "No pipeline paths specified. "
            "Please set the VIAME_PIPELINES_PATH environment variable.",
        )

    pipeline_paths: List[Path] = [Path(p) for p in env_pipelines_paths]

    for path in pipeline_paths:
        if not path.exists():
            raise Exception(f"Specified pipeline path does not exist: {path}")

    return pipeline_paths


def load_static_pipelines() -> Dict[str, PipelineCategory]:
    """Return the static pipelines."""

    pipedict: Dict[str, PipelineCategory] = {}
    static_pipelines_paths = get_static_pipelines_paths()

    for path in static_pipelines_paths:
        pipelist = [
            path.name
            for path in path.glob("./*.pipe")
            if re.match(AllowedStaticPipelines, path.name)
            and not re.match(DisallowedStaticPipelines, path.name)
        ]

        for pipe in pipelist:
            pipe_type, *nameparts = pipe.replace(".pipe", "").split("_")
            pipe_info: PipelineDescription = {
                "name": " ".join(nameparts),
                "type": pipe_type,
                "pipe_name": os.path.join(path, pipe),
                "folderId": None,
            }

            if pipe_type in pipedict:
                pipedict[pipe_type]["pipes"].append(pipe_info)
            else:
                pipedict[pipe_type] = {"pipes": [pipe_info], "description": ""}

    return pipedict


def load_training_configurations() -> TrainingConfigurationSummary:
    """Load existing training configs."""

    main_pipeline_paths: List[Path] = get_static_pipelines_paths()
    configurations: List[TrainingConfiguration] = []
    default_config: TrainingConfiguration = None
    # Find all training configurations in all path locations
    for path in main_pipeline_paths:
        for confpath in path.glob("./*.conf"):
            if confpath.name == DefaultTrainingConfiguration:
                default_config = {
                    'name': confpath.name,
                    'pipe_path': str(confpath),
                }
            configurations.append(
                {
                    'pipe_path': str(confpath),
                    'name': confpath.name,
                }
            )

    # Filter out stuff that doesn't match allowed patterns
    configurations = [
        c for c in configurations if re.match(AllowedTrainingConfigs, c['name'])
    ]

    return {
        "configs": configurations,
        "default": default_config,
    }
