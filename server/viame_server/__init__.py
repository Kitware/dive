from pathlib import Path
from os import getenv

from girder import events, plugin

from .client_webroot import ClientWebroot
from .viame import Viame
from .viame_detection import ViameDetection
from .utils import check_existing_annotations


pipeline_path = Path(
    getenv("VIAME_PIPELINES_PATH", "/home/VIAME/pipelines")
)


def load_pipelines():
    if not pipeline_path.exists():
        return []

    return [path.name for path in pipeline_path.glob("./*.pipe")]


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):
        info["apiRoot"].viame = Viame(pipelines=load_pipelines())
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
