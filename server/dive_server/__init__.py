import os
from pathlib import Path

from girder import events, plugin
from girder.constants import AccessType
from girder.models.setting import Setting
from girder.models.user import User
from girder.utility import mail_utils
from girder.utility.model_importer import ModelImporter

from dive_utils.constants import UserPrivateQueueEnabledMarker

from .client_webroot import ClientWebroot
from .event import process_fs_import, process_s3_import, send_new_user_email
from .views_annotation import AnnotationResource
from .views_dataset import DatasetResource
from .views_override import use_private_queue
from .views_rpc import RpcResource
from .views_summary import SummaryItem, SummaryResource


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):
        ModelImporter.registerModel('summaryItem', SummaryItem, plugin='dive_server')

        info["apiRoot"].dive_summary = SummaryResource("dive_summary")
        info["apiRoot"].dive_annotation = AnnotationResource("dive_annotation")
        info["apiRoot"].dive_dataset = DatasetResource("dive_dataset")
        info["apiRoot"].dive_rpc = RpcResource("dive_rpc")

        # Setup route additions for exsting resources
        info["apiRoot"].user.route("GET", (":id", "use_private_queue"), use_private_queue)
        User().exposeFields(AccessType.READ, UserPrivateQueueEnabledMarker)

        DIVE_MAIL_TEMPLATES = Path(os.path.realpath(__file__)).parent / 'mail_templates'
        mail_utils.addTemplateDirectory(str(DIVE_MAIL_TEMPLATES))

        # Relocate Girder
        info["serverRoot"], info["serverRoot"].girder = (
            ClientWebroot(),
            info["serverRoot"],
        )
        info["serverRoot"].api = info["serverRoot"].girder.api

        events.bind(
            "filesystem_assetstore_imported",
            "process_fs_import",
            process_fs_import,
        )
        events.bind(
            "s3_assetstore_imported",
            "process_s3_import",
            process_s3_import,
        )
        events.bind(
            'model.user.save.created',
            'send_new_user_email',
            send_new_user_email,
        )

        # Create dependency on worker
        plugin.getPlugin('worker').load(info)
        Setting().set(
            'worker.api_url',
            os.environ.get('WORKER_API_URL', 'http://girder:8080/api/v1'),
        )

        broker_url = os.environ.get('CELERY_BROKER_URL', None)
        if broker_url is None:
            raise RuntimeError('CELERY_BROKER_URL must be set')
        Setting().set('worker.broker', broker_url)
