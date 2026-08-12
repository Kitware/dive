"""Compatibility barrel re-exporting Celery tasks and helpers.

Prefer importing from the focused modules directly in new code:
``convert_video``, ``convert_images``, ``run_pipeline``, ``run_training``,
``upgrade_pipelines``, and ``viame_config``.
"""

from dive_tasks.convert_images import (
    convert_calibration,
    convert_images,
    convert_large_images,
    extract_zip,
)
from dive_tasks.convert_video import convert_video, resolve_annotation_fps
from dive_tasks.run_pipeline import (
    _inject_dataset_metadata_file,
    filter_csv_by_frame_range,
    filter_image_list_by_frame_range,
    run_pipeline,
)
from dive_tasks.run_training import export_trained_pipeline, train_pipeline
from dive_tasks.upgrade_pipelines import (
    UPGRADE_JOB_DEFAULT_URLS,
    _addon_zip_path_for_url,
    download_google_drive_zip,
    is_google_drive_addon_url,
    upgrade_pipelines,
)
from dive_tasks.viame_config import EMPTY_JOB_SCHEMA, Config, get_gpu_environment

__all__ = [
    'Config',
    'EMPTY_JOB_SCHEMA',
    'UPGRADE_JOB_DEFAULT_URLS',
    '_addon_zip_path_for_url',
    '_inject_dataset_metadata_file',
    'convert_calibration',
    'convert_images',
    'convert_large_images',
    'convert_video',
    'download_google_drive_zip',
    'export_trained_pipeline',
    'extract_zip',
    'filter_csv_by_frame_range',
    'filter_image_list_by_frame_range',
    'get_gpu_environment',
    'is_google_drive_addon_url',
    'resolve_annotation_fps',
    'run_pipeline',
    'train_pipeline',
    'upgrade_pipelines',
]
