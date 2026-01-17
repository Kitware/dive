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

DefaultTrainingConfiguration = "train_detector_default.conf"
AllowedTrainingConfigs = r"train_.*\.conf$"
DisallowedTrainingConfigs = (
    r".*(_nf|\.continue)\.viame_csv\.conf$|.*\.continue\.conf$|.*\.habcam\.conf$|.*\.kw18\.conf$"
)
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


def extract_pipe_description(pipe_path: Path) -> Optional[str]:
    """
    Extract description from a .pipe file header.
    Looks for "# Description: " in the first 5 lines of the file.
    Description can span multiple lines and ends when:
    - A line starting with "# " followed by "=" is found (e.g., "# ===")
    - A line starting with "#" followed by only whitespace is found
    - A non-comment line is found
    """
    try:
        with open(pipe_path, 'r', encoding='utf-8') as f:
            lines = [line.rstrip('\n\r') for line in f.readlines()]

        # Find the Description: field within the first 5 lines
        header_lines = lines[:5]
        desc_start_index = -1
        for i, line in enumerate(header_lines):
            if re.match(r'^#\s*Description:\s*', line, re.IGNORECASE):
                desc_start_index = i
                break

        if desc_start_index == -1:
            return None

        # Extract the initial description text
        desc_match = re.match(r'^#\s*Description:\s*(.*)$', header_lines[desc_start_index], re.IGNORECASE)
        if not desc_match:
            return None

        description = desc_match.group(1).strip()

        # Continue reading from the line after Description: was found
        for line in lines[desc_start_index + 1:]:
            # End conditions:
            # 1. Line starting with "# " followed by "=" (e.g., "# ===")
            if re.match(r'^#\s*=', line):
                break
            # 2. Line starting with "#" followed by only whitespace
            if re.match(r'^#\s*$', line):
                break
            # 3. Non-comment line (not starting with #)
            if not line.startswith('#'):
                break

            # Continue reading multi-line description
            continued_text = re.sub(r'^#\s*', '', line).strip()
            if continued_text:
                description += ' ' + continued_text

        return description if description else None
    except Exception:
        return None


def load_static_pipelines(search_path: Path) -> Dict[str, PipelineCategory]:
    pipedict: Dict[str, PipelineCategory] = {}

    pipelist = [
        path
        for path in search_path.glob("./*.pipe")
        if re.match(AllowedStaticPipelines, path.name)
        and not re.match(DisallowedStaticPipelines, path.name)
    ]

    for pipe_path in pipelist:
        pipe = pipe_path.name
        pipe_type, *nameparts = pipe.replace(".pipe", "").split("_")

        # Extract description from the pipe file
        description = extract_pipe_description(pipe_path)

        pipe_info: PipelineDescription = {
            "name": " ".join(nameparts),
            "type": pipe_type,
            "pipe": pipe,
            "description": description,
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
