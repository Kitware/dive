import os
import re
import sys
from os import getenv
from pathlib import Path

from girder import events, plugin
from girder.models.setting import Setting
from girder_worker.girder_plugin import WorkerPlugin

from .client_webroot import ClientWebroot
from .event import check_existing_annotations
from .viame import Viame
from .viame_detection import ViameDetection

env_pipelines_path = getenv("VIAME_PIPELINES_PATH")


def load_pipelines():
    if env_pipelines_path is None:
        print(
            "No pipeline path specified. ",
            "Please set the VIAME_PIPELINES_PATH environment variable.",
            file=sys.stderr,
        )
        return []

    pipeline_path = Path(env_pipelines_path)
    if not pipeline_path.exists():
        print("Specified pipeline path does not exist!", file=sys.stderr)
        return []

    allowed = r"^detector_.+|^tracker_.+|^generate_.+"
    disallowed = r".*local.*|detector_svm_models.pipe|tracker_svm_models.pipe"
    pipelist = [
        path.name
        for path in pipeline_path.glob("./*.pipe")
        if re.match(allowed, path.name) and not re.match(disallowed, path.name)
    ]
    pipedict = {}
    for pipe in pipelist:
        pipe_type, *nameparts = pipe.replace(".pipe", "").split("_")
        pipe_info = {"name": " ".join(nameparts), "type": pipe_type, "pipe": pipe}

        if pipe_type in pipedict:
            pipedict[pipe_type]["pipes"].append(pipe_info)
        else:
            pipedict[pipe_type] = {"pipes": [pipe_info], "description": ""}

    return pipedict


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
