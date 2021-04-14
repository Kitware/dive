import os
from urllib.parse import urlparse

from bson.objectid import ObjectId
from dive_server.pipelines import run_pipeline
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import SortDir
from girder.exceptions import RestException
from girder.models.assetstore import Assetstore
from girder.models.folder import Folder
from girder.models.user import User

from dive_server.utils import PydanticModel, saveTracks
from dive_utils import constants, models
from dive_utils.types import GirderModel

# Example bucket notification
"""
{
  "message": {
    "attributes": {
      "bucketId": "brandon-dive-bucket",
      "objectId": "folder3/20160115_MUSKEGET_SSLC0612.JPG",
      "eventType": "OBJECT_FINALIZE"
    },
    "data": "data",
    "messageId": "2161605533400057",
    "publishTime": "2021-04-11T00:40:24.977Z"
  },
  "subscription": "projects/myproject/subscriptions/mysubscription"
}
"""


def ingest_uri(
    folder: GirderModel, msg: models.GCSPushNotificationMessage, video=False
) -> GirderModel:
    # TODO: verify that the object origin is associated with a user
    # who has opted to subscribe to such notifications
    uripath = urlparse(msg.attributes.objectId).path
    parentdir, filename = os.path.split(uripath)
    # TODO find the assetstore given the user configuration
    store = Assetstore().findOne(
        {
            'type': 2,  # S3 type
        }
    )
    importdest = Folder().createFolder(
        folder,
        parentdir.lstrip('/').replace('/', '_'),
        description=f"Imported from GCS bucket {msg.attributes.bucketId}",
        public=False,
        reuseExisting=True,
    )
    # TODO need a user for this.
    userId = importdest['creatorId'] or importdest['baseParentId']
    user = User().findOne({'_id': ObjectId(userId)})

    if video:
        # Need to create another level of directory
        importdest = Folder().createFolder(
            importdest,
            filename,
            description=f"Video GCS import",
            public=False,
            reuseExisting=False,
        )
    if store is not None:
        Assetstore().importData(
            store,
            importdest,
            'folder',
            {'importPath': parentdir},
            None,
            user,
        )
    saveTracks(importdest, {}, user)
    return user, importdest


class GCSNotificationRecord(PydanticModel):
    def initialize(self):
        return super().initialize("gcsnotification", models.GCSPushNotificationMessage)


class GCSNotification(Resource):
    def __init__(self):
        super(GCSNotification, self).__init__()
        self.resourceName = "gcs"
        self.route("GET", ("notifications",), self.get_records)
        self.route("POST", ("notifications", ':folderId'), self.save_record)

    @access.public
    @autoDescribeRoute(
        Description("Post notification record")
        .param(
            'folderId',
            description='destination folder id',
            paramType='path',
        )
        .jsonParam("data", "json body", paramType="body", requireObject=True)
    )
    def save_record(self, folderId: str, data: dict):
        """
        https://cloud.google.com/pubsub/docs/push#receiving_messages
        """
        payload = models.GCSPushNotificationPayload(**data)
        doc = payload.message
        GCSNotificationRecord().create(doc)
        folder = Folder().findOne({'_id': ObjectId(folderId)})
        if folder is None:
            raise RestException(f'No folder with id={folderId}')
        dataset_folder = None
        user = None

        if constants.imageRegex.search(doc.attributes.objectId):
            user, dataset_folder = ingest_uri(folder, doc)
            # This is an image
            dataset_folder['meta'] = {
                constants.DatasetMarker: True,
                constants.TypeMarker: constants.ImageSequenceType,
                'fps': 1,
            }
        elif constants.videoRegex.search(doc.attributes.objectId):
            user, dataset_folder = ingest_uri(folder, doc, video=True)
            dataset_folder['meta'] = {
                constants.DatasetMarker: True,
                constants.TypeMarker: constants.VideoType,
                'fps': constants.DefaultVideoFPS,
            }
        else:
            # This event is not meaningful for us
            print(doc)
            return doc

        Folder().save(dataset_folder)
        try:
            run_pipeline(
                user,
                dataset_folder,
                {
                    'name': 'empty frame lbls 1fr',
                    'type': 'utility',
                    'pipe': 'utility_empty_frame_lbls_1fr.pipe',
                    'folderId': None,
                },
            )
        except RestException:
            pass
        return dataset_folder

    @access.user
    @autoDescribeRoute(
        Description("List gcs notifications").pagingParams(
            "publishTime", defaultSortDir=SortDir.DESCENDING
        )
    )
    def get_records(self, params: dict):
        limit, offset, sort = self.getPagingParameters(params)
        return GCSNotificationRecord().findWithPermissions(
            offset=offset, limit=limit, sort=sort, user=self.getCurrentUser()
        )
