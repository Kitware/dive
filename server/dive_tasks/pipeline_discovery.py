import os
from pathlib import Path
import re
from typing import Dict, List, Optional

from dive_utils.constants import TrainingModelExtensions
from dive_utils.types import (
    AvailableJobSchema,
    PipelineCategory,
    PipelineDescription,
    PipeMetadata,
    TrainingConfigurationSummary,
    TrainingModelDescription,
)

DefaultTrainingConfiguration = "train_detector_default.conf"
AllowedTrainingConfigs = r"train_.*\.conf$"
DisallowedTrainingConfigs = (
    r".*(_nf|\.continue)\.viame_csv\.conf$|.*\.continue\.conf$|.*\.habcam\.conf$|.*\.kw18\.conf$"
)
# Align with desktop getPipelineList allow patterns (common.ts).
AllowedStaticPipelines = (
    r"^filter_.+|^transcode_.+|^detector_.+|^tracker_.+|^generate_.+|^utility_.+|"
    r"^measurement_.+|.*[23]-cam.+"
)

DisallowedStaticPipelines = (
    r"common_stereo_.*\.pipe|"
    # Remove utilities pipes which hold no meaning in web
    r".*local.*|"
    r".*seagis.*|"
    r".*hough.*|"
    r".*_svm_models\.pipe|"
    r"detector_extract_chips\.pipe|"
    # Remove tracker pipelines which hold no meaning in web
    r"tracker_stabilized_iou\.pipe|"
    r"tracker_short_term\.pipe"
)


def parse_pipe_type_and_name(pipe_stem: str) -> tuple[str, str]:
    """
    Derive pipeline category and display name from a .pipe stem.

    Matches desktop: 2-cam/3-cam pipelines use their own category; 1-cam stay under
    detector/tracker/utility prefixes.
    """
    parts = pipe_stem.split('_')
    if len(parts) > 1 and parts[-1] == 'cam' and parts[-2] != '1':
        pipe_type = f'{parts[-2]}-cam'
        return pipe_type, ' '.join(parts)
    multicam_suffix = re.search(r'(?:^|_)([23])-cam$', pipe_stem)
    if multicam_suffix:
        pipe_type = f'{multicam_suffix.group(1)}-cam'
        return pipe_type, pipe_stem.replace('_', ' ')
    pipe_type = parts[0]
    return pipe_type, ' '.join(parts[1:])


def extract_pipe_metadata(file_path: Path) -> PipeMetadata:
    metadata: PipeMetadata = {"diveParams": []}

    context_stack: List[str] = []
    in_description = False
    full_description_parts: List[str] = []

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line_raw = line.rstrip('\n\r')
                trimmed = line_raw.strip()
                if not trimmed:
                    continue

                process_match = re.match(r'^process\s+([\w-]+)', trimmed, re.IGNORECASE)
                if process_match:
                    context_stack = [process_match.group(1)]
                    continue

                block_match = re.match(r'^block\s+([\w:-]+)', trimmed, re.IGNORECASE)
                if block_match:
                    context_stack.append(block_match.group(1))
                    continue

                if trimmed.lower() == 'endblock':
                    if context_stack:
                        context_stack.pop()
                    continue

                dive_match = re.search(
                    r'#\s*DIVE_PARAM\s*\[\s*"([^"]+)"\s*,\s*(.+)\s*\]', line_raw, re.IGNORECASE
                )
                if dive_match:
                    label, raw_args = dive_match.groups()
                    args = [arg.strip() for arg in raw_args.split(',')]
                    param_type = args[0]
                    pipeline_type_args = args[1:]

                    param_line_match = re.match(
                        r'^(?:relativepath\s+)?(?::)?([\w:-]+)\s*=?\s*([^#]+)',
                        trimmed,
                        re.IGNORECASE,
                    )
                    if param_line_match:
                        local_key = param_line_match.group(1)
                        default_val = param_line_match.group(2).strip()
                        full_key = ":".join(context_stack + [local_key])

                        metadata["diveParams"].append(
                            {
                                "label": label,
                                "type": param_type,
                                "type_props": pipeline_type_args,
                                "key": full_key,
                                "default": default_val,
                            }
                        )

                # --- Description extraction (Multiline) ---
                desc_start_match = re.match(r'^#\s*Description:\s*(.*)', line_raw, re.IGNORECASE)
                if desc_start_match:
                    in_description = True
                    content = desc_start_match.group(1).strip()
                    if content:
                        full_description_parts.append(content)
                    continue

                if in_description:
                    is_stop_condition = (
                        re.match(r'^#\s*$', line_raw)
                        or re.match(r'^#\s*=', line_raw)
                        or re.match(
                            r'^#\s*(Input|Output|Requires\s+Calibration|Metadata\s+File'
                            r'|Image\s+List\s+Keys?|Frame\s+List\s+Keys?):',
                            line_raw,
                            re.IGNORECASE,
                        )
                        or not line_raw.startswith('#')
                    )

                    if is_stop_condition:
                        in_description = False
                    else:
                        continued_text = re.sub(r'^#\s*', '', line_raw).strip()
                        if continued_text:
                            full_description_parts.append(continued_text)

                # --- Input / Output extraction ---
                input_match = re.match(r'^#\s*Input:\s*(.*)', line_raw, re.IGNORECASE)
                if input_match:
                    metadata["inputType"] = input_match.group(1).strip()

                output_match = re.match(r'^#\s*Output:\s*(.*)', line_raw, re.IGNORECASE)
                if output_match:
                    metadata["outputType"] = output_match.group(1).strip()

                calibration_match = re.match(
                    r'^#\s*Requires\s+Calibration:\s*(.*)', line_raw, re.IGNORECASE
                )
                if calibration_match:
                    metadata["requiresCalibration"] = calibration_match.group(1).strip().lower() in (
                        'true',
                        'yes',
                        '1',
                    )

                # `# Metadata File: <block>:<key>` opts a pipe in to receiving the
                # dataset's optional metadata file as a `-s <block>:<key>=<path>` override.
                metadata_file_match = re.match(
                    r'^#\s*Metadata\s+File:\s*(.+)', line_raw, re.IGNORECASE
                )
                if metadata_file_match:
                    value = metadata_file_match.group(1).strip()
                    if value:
                        metadata["metadataFileKey"] = value

                # `# Image List Keys: <k> [k...]` binds the primary (first-camera /
                # single) input image-list manifest to each listed KWIVER key.
                # `# Frame List Keys: <k> [k...]` binds the comma-joined per-camera
                # manifests. Lets pipes (e.g. the sea-lion registration stabilizer)
                # read the same image list DIVE feeds the input reader.
                image_list_match = re.match(
                    r'^#\s*Image\s+List\s+Keys?:\s*(.+)', line_raw, re.IGNORECASE
                )
                if image_list_match:
                    keys = [k for k in re.split(r'[\s,]+', image_list_match.group(1).strip()) if k]
                    if keys:
                        metadata["imageListKeys"] = keys

                frame_list_match = re.match(
                    r'^#\s*Frame\s+List\s+Keys?:\s*(.+)', line_raw, re.IGNORECASE
                )
                if frame_list_match:
                    keys = [k for k in re.split(r'[\s,]+', frame_list_match.group(1).strip()) if k]
                    if keys:
                        metadata["frameListKeys"] = keys

        if full_description_parts:
            metadata["description"] = " ".join(full_description_parts)
        else:
            metadata["description"] = None

    except Exception as e:
        print(f"Error while reading {file_path} metadata: {e}")

    return metadata


def load_static_pipelines(search_path: Path) -> Dict[str, PipelineCategory]:
    pipedict: Dict[str, PipelineCategory] = {}

    pipelist = [
        path
        for path in search_path.glob("./*.pipe")
        if re.match(AllowedStaticPipelines, path.name, re.IGNORECASE)
        and not re.match(DisallowedStaticPipelines, path.name, re.IGNORECASE)
    ]

    for pipe_path in pipelist:
        pipe = pipe_path.name
        pipe_stem = pipe.replace('.pipe', '')
        pipe_type, pipe_name = parse_pipe_type_and_name(pipe_stem)

        metadata = extract_pipe_metadata(pipe_path)

        pipe_info: PipelineDescription = {
            "name": pipe_name,
            "type": pipe_type,
            "pipe": pipe,
            "metadata": metadata,
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
