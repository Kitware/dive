import os
import sys
from pathlib import Path

from girder import events, plugin
from girder.models.setting import Setting

from .client_webroot import ClientWebroot
from .event import check_existing_annotations
from .viame import Viame
from .viame_detection import ViameDetection

from typing import Tuple, Optional

env_pipelines_path = os.getenv("VIAME_PIPELINES_PATH")
env_trained_pipelines_path = os.getenv("VIAME_TRAINED_PIPELINES_PATH")


def get_pipeline_paths() -> Tuple[Optional[Path], Optional[Path]]:
    if env_pipelines_path is None:
        print(
            "No pipeline path specified. ",
            "Please set the VIAME_PIPELINES_PATH environment variable.",
            file=sys.stderr,
        )
        main_pipeline_path = None
    else:
        main_pipeline_path = Path(env_pipelines_path)
        if not main_pipeline_path.exists():
            print("Specified pipeline path does not exist!", file=sys.stderr)
            main_pipeline_path = None

    if env_trained_pipelines_path is None:
        print(
            "No trained pieline path specified. ",
            "Please set the VIAME_TRAINED_PIPELINES_PATH environment variable.",
            file=sys.stderr,
        )
        trained_pipeline_path = None
    else:
        trained_pipeline_path = Path(env_trained_pipelines_path)
        if not trained_pipeline_path.exists():
            print("Specified trained pipeline path does not exist!", file=sys.stderr)
            trained_pipeline_path = None

    return (main_pipeline_path, trained_pipeline_path)


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):

        info["apiRoot"].viame = Viame(pipeline_paths=get_pipeline_paths())
        info["apiRoot"].viame_detection = ViameDetection()
        # Relocate Girder
        info["serverRoot"], info["serverRoot"].girder = (
            ClientWebroot(),
            info["serverRoot"],
        )
        info["serverRoot"].api = info["serverRoot"].girder.api

        events.bind(
            "filesystem_assetstore_imported",
            "check_annotations",
            check_existing_annotations,
        )

        # Create dependency on worker
        plugin.getPlugin('worker').load(info)
        Setting().set(
            'worker.api_url',
            os.environ.get('WORKER_API_URL', 'http://girder:8080/api/v1'),
        )
        Setting().set(
            'worker.broker',
            os.environ.get('WORKER_BROKER', 'amqp://guest:guest@rabbit/'),
        )
        Setting().set(
            'worker.backend',
            os.environ.get('WORKER_BACKEND', 'amqp://guest:guest@rabbit/'),
        )
