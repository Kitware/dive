from datetime import datetime, timedelta
import os

from bson.objectid import ObjectId
from girder import logger
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.setting import Setting
from girder.models.user import User
from girder.settings import SettingKey
from girder.utility.mail_utils import renderTemplate, sendMail

from dive_utils import asbool, fromMeta
from dive_utils.constants import (
    AssetstoreSourceMarker,
    AssetstoreSourcePathMarker,
    DatasetMarker,
    DefaultVideoFPS,
    FPSMarker,
    ImageSequenceType,
    LargeImageType,
    MarkForPostProcess,
    TypeMarker,
    VideoType,
    imageRegex,
    largeImageRegEx,
    videoRegex,
)

from . import crud_rpc


def send_new_user_email(event):
    try:
        info = event.info
        email = info.get('email')
        brandName = Setting().get(SettingKey.BRAND_NAME)
        rendered = renderTemplate('welcome.mako')
        sendMail(f'Welcome to {brandName}', rendered, [email])
    except Exception:
        logger.exception("Failed to send new user email")


def process_assetstore_import(event, meta: dict):
    """
    Function for appending the appropriate metadata to no-copy import data
    """
    info = event.info
    objectType = info.get("type")
    importPath = info.get("importPath")

    if not importPath or not objectType or objectType != "item":
        return

    dataset_type = None
    item = Item().findOne({"_id": info["id"]})
    item['meta'].update(
        {
            **meta,
            AssetstoreSourcePathMarker: importPath,
        }
    )

    if imageRegex.search(importPath):
        dataset_type = ImageSequenceType

    elif videoRegex.search(importPath):
        # Look for existing video dataset directory
        parentFolder = Folder().findOne({"_id": item["folderId"]})
        userId = parentFolder['creatorId'] or parentFolder['baseParentId']
        user = User().findOne({'_id': ObjectId(userId)})
        foldername = f'Video {item["name"]}'
        # resuse existing folder if it already exists with same name
        dest = Folder().createFolder(parentFolder, foldername, creator=user, reuseExisting=True)
        now = datetime.now()
        if now - dest['created'] > timedelta(hours=1):
            # Remove the old  referenced item, replace it with the new one.
            oldItem = Item().findOne({'folderId': dest['_id'], 'name': item['name']})
            if oldItem is not None:
                if oldItem['meta'].get('codec', False):
                    meta = {
                        'source_video': oldItem['meta'].get('source_video', None),
                        'transcoder': oldItem['meta'].get('ffmpeg', None),
                        'originalFps': oldItem['meta'].get('originalFps', None),
                        'originalFpsString': oldItem['meta'].get('originalFpsString', None),
                        'codec': oldItem['meta'].get('codec', None),
                    }
                    item['meta'].update(meta)
                    Item().save(item)
                Item().remove(oldItem)
        Item().move(item, dest)
        # Set the dataset to Video Type
        dataset_type = VideoType

    if dataset_type is not None:
        # Update metadata of parent folder
        Item().save(item)
        folder = Folder().findOne({"_id": item["folderId"]})
        root, _ = os.path.split(importPath)
        # if the parent folder is not marked as a DIVE Dataset, Mark it.
        if not asbool(fromMeta(folder, DatasetMarker)):
            folder["meta"].update(
                {
                    TypeMarker: dataset_type,  # Sets to video
                    FPSMarker: -1,  # auto calculate the FPS from import
                    AssetstoreSourcePathMarker: root,
                    MarkForPostProcess: True,  # skip transcode or transcode if required
                    **meta,
                }
            )
            Folder().save(folder)


def convert_video_recrusive(folder, user):
    subFolders = list(Folder().childFolders(folder, 'folder', user))
    for child in subFolders:
        if child.get('meta', {}).get(MarkForPostProcess, False):
            child['meta']['MarkForPostProcess'] = False
            Folder().save(child)
            crud_rpc.postprocess(user, child, False, True)
        convert_video_recrusive(child, user)


class DIVES3Imports:
    destinationId = None
    destinationType = None

    def process_s3_import_before(self, event):
        self.destinationId = event.info.get('params', {}).get('destinationId')
        self.destinationType = event.info.get('params', {}).get('destinationType')

    def process_s3_import_after(self, event):
        if self.destinationType == 'folder' and self.destinationId is not None:
            # go through all sub folders and add a new script to convert
            destinationFolder = Folder().findOne({"_id": ObjectId(self.destinationId)})
            print(destinationFolder)
            userId = destinationFolder['creatorId'] or destinationFolder['baseParentId']
            user = User().findOne({'_id': ObjectId(userId)})
            convert_video_recrusive(destinationFolder, user)
        self.destinationId = None
        self.destinationType = None


def process_fs_import(event):
    return process_assetstore_import(event, {AssetstoreSourceMarker: 'filesystem'})


def process_s3_import(event):
    return process_assetstore_import(event, {AssetstoreSourceMarker: 's3'})
