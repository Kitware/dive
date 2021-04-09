import re
from typing import Dict
from urllib.parse import urlparse
import os
from bson.objectid import ObjectId

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType, SortDir
from girder.models.folder import Folder
from girder.models.user import User
from girder.models.assetstore import Assetstore

from dive_server.utils import PydanticModel
from dive_utils import models, constants
from dive_utils.types import GirderModel


def ingest_uri(folder: GirderModel, gcs_uri: str, video=False) -> GirderModel:
    # TODO: verify that the object origin is associated with a user
    # who has opted to subscribe to such notifications
    parsed = urlparse(gcs_uri)
    uripath = parsed.path
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
        description=f"Imported from GCS bucket {parsed.netloc}",
        public=False,
        reuseExisting=True,
    )
    # TODO need a user for this.
    userId = importdest['creatorId'] or importdest['baseParentId']
    user = User().findOne({'_id': ObjectId(userId)})

    if video:
        # Need to create another level of directory
        importdest = Folder.createFolder(
            importdest,
            filename,
            description=f"Video GCS import",
            public=False,
            reuseExisting=False,
        )
    if store is not None:
        print(store)
        print(uripath)
        Assetstore().importData(
            store,
            importdest,
            'folder',
            {'importPath': parentdir},
            None,
            user,
        )
    return importdest


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
        .modelParam(
            'folderId',
            description='destination folder id',
            model=Folder,
            level=AccessType.NONE,
        )
        .jsonParam("data", "json body", paramType="body", requireObject=True)
    )
    def save_record(self, folder: GirderModel, data: dict):
        """
        https://cloud.google.com/pubsub/docs/push#receiving_messages
        """
        doc = models.GCSPushNotificationMessage(**data['message'])
        GCSNotificationRecord().create(doc)
        dataset_folder = None

        if constants.imageRegex.search(doc.attributes.objectId):
            dataset_folder = ingest_uri(folder, doc.attributes.objectId)
            # This is an image
            dataset_folder['meta'] = {
                constants.DatasetMarker: True,
                constants.TypeMarker: constants.ImageSequenceType,
                'fps': 1,
            }
        elif constants.videoRegex.search(doc.attributes.objectId):
            dataset_folder = ingest_uri(folder, doc.attributes.objectId, video=True)
            dataset_folder['meta'] = {
                constants.DatasetMarker: True,
                constants.TypeMarker: constants.VideoType,
                'fps': constants.DefaultVideoFPS,
            }

        Folder().save(dataset_folder)
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
