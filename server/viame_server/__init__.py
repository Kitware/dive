import os
import re
import sys
from pathlib import Path

from girder import events, plugin
from girder.models.setting import Setting
from girder_worker.girder_plugin import WorkerPlugin

from .client_webroot import ClientWebroot
from .event import check_existing_annotations, maybe_mark_folder_for_annotation
from .viame import Viame
from .viame_detection import ViameDetection

env_pipelines_path = os.getenv("VIAME_PIPELINES_PATH")
env_trained_pipelines_path = os.getenv("VIAME_TRAINED_PIPELINES_PATH")


def get_pipeline_paths():
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


def load_pipelines():
    main_pipeline_path, trained_pipeline_path = get_pipeline_paths()

    pipelist = []
    if main_pipeline_path is not None:
        allowed = r"^detector_.+|tracker_.+"
        disallowed = r".*local.*|detector_svm_models.pipe|tracker_svm_models.pipe"
        pipelist.extend(
            [
                path.name
                for path in main_pipeline_path.glob("./*.pipe")
                if re.match(allowed, path.name) and not re.match(disallowed, path.name)
            ]
        )

    if trained_pipeline_path is not None:
        pipelist.extend([path.name for path in trained_pipeline_path.glob("./*.pipe")])

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
        events.bind(
            "model.upload.finalize", "fileUpload", maybe_mark_folder_for_annotation,
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
