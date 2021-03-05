import os
import sys
from pathlib import Path

from girder import events, plugin
from girder.models.setting import Setting
from girder.utility import setting_utilities

from .constants import SETTINGS_CONST_JOBS_CONFIGS
from .client_webroot import ClientWebroot
from .event import check_existing_annotations
from .viame import Viame
from .viame_detection import ViameDetection


@setting_utilities.validator({SETTINGS_CONST_JOBS_CONFIGS})
def validateSettings(doc):
    """
    Handle plugin-specific system settings. Right now we don't do any
    validation.
    """
    val = doc['value']
    # TODO: replace with real schema validation
    assert 'training' in val, '"training" missing from doc'
    assert 'pipelines' in val, '"piplines" missing from doc'


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):

        info["apiRoot"].viame = Viame()
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
