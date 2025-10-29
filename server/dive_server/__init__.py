import os
import logging
from pathlib import Path

from girder import events, plugin
from girder.constants import AccessType
from girder.models.setting import Setting
from girder.models.user import User
from girder.plugin import getPlugin
from girder.utility import mail_utils
from girder.utility.model_importer import ModelImporter
from girder_jobs.models.job import Job

from dive_utils import constants

from .crud_annotation import GroupItem, RevisionLogItem, TrackItem
from .event import DIVES3Imports, process_fs_import, process_s3_import, send_new_user_email
from .views_annotation import AnnotationResource
from .views_configuration import ConfigurationResource
from .views_dataset import DatasetResource
from .views_override import (
    countJobs,
    get_root_path_or_relative,
    list_shared_folders,
    use_private_queue,
)
from .views_rpc import RpcResource

logger = logging.getLogger(__name__)

class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):
        ModelImporter.registerModel('trackItem', TrackItem, plugin='dive_server')
        ModelImporter.registerModel('groupItem', GroupItem, plugin='dive_server')
        ModelImporter.registerModel('revisionLogItem', RevisionLogItem, plugin='dive_server')

        info["apiRoot"].dive_annotation = AnnotationResource("dive_annotation")
        info["apiRoot"].dive_configuration = ConfigurationResource("dive_configuration")
        info["apiRoot"].dive_dataset = DatasetResource("dive_dataset")
        info["apiRoot"].dive_rpc = RpcResource("dive_rpc")
        # required because girder doesn't load plugins in order so we need to manually load first.
        getPlugin('jobs').load(info)
        # Setup route additions for exsting resources
        info['apiRoot'].job.route("GET", ("queued",), countJobs)
        info["apiRoot"].user.route("PUT", (":id", "use_private_queue"), use_private_queue)
        info["apiRoot"].folder.route("GET", ("shared-folders",), list_shared_folders)
        info["apiRoot"].folder.route(
            "GET", (":id", "rootpath_or_relative"), get_root_path_or_relative
        )
        User().exposeFields(AccessType.READ, constants.UserPrivateQueueEnabledMarker)

        # Expose Job dataset assocation
        Job().exposeFields(AccessType.READ, constants.JOBCONST_DATASET_ID)

        DIVE_MAIL_TEMPLATES = Path(os.path.realpath(__file__)).parent / 'mail_templates'
        mail_utils.addTemplateDirectory(str(DIVE_MAIL_TEMPLATES))

        core_girder = info['serverRoot'].apps['']
        core_girder.script_name = '/girder'
        info['serverRoot'].mount(core_girder, '/girder', core_girder.config)
        del info['serverRoot'].apps['']

        vue_root = '/opt/dive/clients/dive'

        conf = {
            '/': {
                'tools.staticdir.on': True,
                'tools.staticdir.dir': '/opt/dive/clients/dive',
                'tools.staticdir.index': 'index.html',
            },
        }
        info['serverRoot'].mount(None, '', conf)

        diveS3Import = DIVES3Imports()
        events.bind(
            "rest.post.assetstore/:id/import.before",
            "process_s3_import_before",
            diveS3Import.process_s3_import_before,
        )

        events.bind(
            "rest.post.assetstore/:id/import.after",
            "process_s3_import_after",
            diveS3Import.process_s3_import_after,
        )
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
