import os
from pathlib import Path
from typing import Dict

from GPUtil import getGPUs

from dive_tasks import utils
from dive_utils.types import AvailableJobSchema

EMPTY_JOB_SCHEMA: AvailableJobSchema = {
    'pipelines': {},
    'training': {
        'configs': [],
        'default': None,
    },
    'models': {},
}


def get_gpu_environment() -> Dict[str, str]:
    """Get environment variables for using CUDA enabled GPUs."""
    env = os.environ.copy()

    gpu_uuid = env.get("WORKER_GPU_UUID")
    gpus = [gpu.id for gpu in getGPUs() if gpu.uuid == gpu_uuid]

    # Only set this env var if WORKER_GPU_UUID was supplied,
    # and it matches an installed GPU
    if gpus:
        env["CUDA_VISIBLE_DEVICES"] = str(gpus[0])
    # Support for NOAA python3.10 means removing the local venv from the path
    env["PATH"] = env.get("PATH").replace("/opt/dive/local/venv/bin", "")
    return env


_VIAME_WORKER_QUEUES = frozenset({'pipelines', 'training'})


def _worker_requires_viame_install() -> bool:
    """
    Only pipeline/training workers need a local VIAME install.

    Default (``celery``), ``local``, and dev ``localworker`` processes do not;
    they never call :class:`Config` today, but this keeps :meth:`Config.__init__`
    safe if a task is misrouted.
    """
    queues = os.environ.get('WORKER_WATCHING_QUEUES', '')
    watched = {q.strip() for q in queues.split(',') if q.strip()}
    return bool(watched & _VIAME_WORKER_QUEUES)


class Config:
    def __init__(self):
        self.gpu_process_env = get_gpu_environment()
        self.viame_install_directory = os.environ.get(
            'VIAME_INSTALL_PATH',
            '/opt/noaa/viame',
        )
        self.addon_root_directory = os.environ.get(
            'ADDON_ROOT_DIR',
            '/tmp/addons',
        )
        self.kwiver_log_level = os.environ.get(
            'KWIVER_DEFAULT_LOG_LEVEL',
            'warn',
        )

        self.pipeline_subdir = 'configs/pipelines'
        self.viame_install_path = Path(self.viame_install_directory)
        self.viame_setup_script = self.viame_install_path / "setup_viame.sh"
        self.viame_executable = self.viame_install_path / "bin" / "viame"
        self.viame_pipeline_path = self.viame_install_path / self.pipeline_subdir

        if _worker_requires_viame_install():
            self.require_viame_install()

        self.addon_root_path = Path(self.addon_root_directory)
        self.addon_zip_path = utils.make_directory(self.addon_root_path / 'zips')
        self.addon_extracted_path = utils.make_directory(self.addon_root_path / 'extracted')

        # Set include directory to include pipelines from this path
        # https://github.com/VIAME/VIAME/issues/131
        self.gpu_process_env['SPROKIT_PIPE_INCLUDE_PATH'] = str(
            self.addon_extracted_path / self.pipeline_subdir
        )

    def require_viame_install(self) -> None:
        assert self.viame_install_path.exists(), "VIAME Base install directory missing."
        assert self.viame_setup_script.is_file(), "VIAME Setup Script missing"
        assert self.viame_executable.is_file(), "VIAME Executable missing"
        assert self.viame_pipeline_path.exists(), "VIAME common pipe directory missing."

    def get_extracted_pipeline_path(self, missing_ok=False) -> Path:
        """
        Includes subdirectory for pipelines
        """
        pipeline_path = self.addon_extracted_path / self.pipeline_subdir
        if not missing_ok:
            assert pipeline_path.exists(), f"Missing path {pipeline_path}"
        return pipeline_path
