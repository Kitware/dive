import logging
import os

from bson.objectid import ObjectId
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import SortDir
from girder.exceptions import RestException
from girder.models.assetstore import Assetstore
from girder.models.folder import Folder
from girder.models.user import User

from dive_utils.types import AssetstoreModel, GirderModel

from .constants import AssetstoreRuleMarker
from .models import GCSNotificationRecord, GCSPushNotificationPayload, NotificationRouterRule

logger = logging.getLogger(__name__)


class BucketNotification(Resource):
    def __init__(self):
        super(BucketNotification, self).__init__()
        self.resourceName = "bucket_notifications"

        self.route("POST", ("routing", ":id"), self.set_notification_routing)
        self.route("GET", ("gcs",), self.gcs_get_records)
        self.route("POST", ('gcs',), self.gcs_save_record)

    @staticmethod
    def processNotification(store: AssetstoreModel, rootFolder: GirderModel, importPath: str):
        """
        Import at proper location
        """
        if rootFolder is None:
            raise RestException('Root folder missing')
        # Find the correct import location given rootFolder and importPath
        owner = User().findOne(
            {'_id': ObjectId(rootFolder['creatorId'] or rootFolder['baseParentId'])}
        )
        if owner is None:
            raise RestException('Root has no owner')

        target = rootFolder

        importPath = importPath.lstrip('/')
        realImportPathDir, _ = os.path.split(importPath)
        storePrefix = str(store['prefix']).lstrip('/')
        common_path = os.path.commonpath([storePrefix, importPath])

        realImportPath = common_path
        path_from_root = importPath[len(common_path) :].lstrip('/')
        path_from_root_list, _ = os.path.split(path_from_root)

        for folder_name in path_from_root_list.split('/'):
            new_target = Folder().findOne(
                {
                    'parentId': ObjectId(target['_id']),
                    'name': folder_name,
                }
            )
            new_import_path = f'{realImportPath}/{folder_name}'
            if new_target is not None:
                target = new_target
                realImportPath = new_import_path
            else:
                break

        realImportPath = realImportPath.lstrip('/')

        if realImportPath == realImportPathDir:
            # All the chain of parent directories exist
            realImportPath = importPath

        Assetstore().importData(
            store,
            target,
            'folder',
            {'importPath': realImportPath},
            None,
            owner,
            force_recursive=False,
        )

    @access.admin
    @autoDescribeRoute(
        Description("Configure notification routing")
        .modelParam('id', description="Assetstore ID", model=Assetstore)
        .jsonParam("data", "json body", paramType="body", requireObject=True)
    )
    def set_notification_routing(self, assetstore, data: dict):
        """
        Configure routing rules for notifications received
        from GCP on buckets aready mapped as assetstores
        """
        assetstore[AssetstoreRuleMarker] = NotificationRouterRule(**data).dict()
        Assetstore().save(assetstore)
        return assetstore

    @access.public
    @autoDescribeRoute(
        Description("Post notification record from GCS").jsonParam(
            "data", "json body", paramType="body", requireObject=True
        )
    )
    def gcs_save_record(self, data: dict):
        """
        https://cloud.google.com/pubsub/docs/push#receiving_messages
        """
        try:
            payload = GCSPushNotificationPayload(**data)
            GCSNotificationRecord().create(payload.message)
            if payload.message.attributes.eventType == 'OBJECT_FINALIZE':
                # This is a create notification
                store = Assetstore().findOne(
                    {
                        'type': 2,  # S3 type
                        AssetstoreRuleMarker: {'$exists': True},
                        'bucket': payload.message.attributes.bucketId,
                        # The only viable GSC Service string
                        'service': 'https://storage.googleapis.com',
                    }
                )
                if store is not None:
                    rule = NotificationRouterRule(**store[AssetstoreRuleMarker])
                    mountRoot = Folder().findOne({'_id': ObjectId(rule.folderId)})
                    BucketNotification.processNotification(
                        store, mountRoot, payload.message.attributes.objectId
                    )
        except Exception as err:
            # exceptions must be swallowed to prevent pub/sub queue backups
            # message loss is always easily recoverable by running a manual
            # import through the admin console.
            logger.exception(f'Failed to process GCS notification {err}')

        return "done"

    @access.user
    @autoDescribeRoute(
        Description("List notifications from GCS").pagingParams(
            "publishTime", defaultSortDir=SortDir.DESCENDING
        )
    )
    def gcs_get_records(self, params: dict):
        limit, offset, sort = self.getPagingParameters(params)
        return GCSNotificationRecord().findWithPermissions(
            offset=offset, limit=limit, sort=sort, user=self.getCurrentUser()
        )
