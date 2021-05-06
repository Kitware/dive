from girder import plugin
from girder.constants import AccessType
from girder.models.assetstore import Assetstore
from girder.utility.model_importer import ModelImporter

from .constants import AssetstoreRuleMarker
from .views import BucketNotification, GCSNotificationRecord


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):
        Assetstore().exposeFields(AccessType.READ, AssetstoreRuleMarker)
        ModelImporter.registerModel(
            GCSNotificationRecord().name,
            GCSNotificationRecord,
            plugin='dive_server',
        )
        info["apiRoot"].bucket_notifications = BucketNotification()
