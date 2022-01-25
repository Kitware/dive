from datetime import datetime
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
    TypeMarker,
    VideoType,
    imageRegex,
    videoRegex,
)


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
    now = datetime.now()

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

    # TODO figure out what's going on here?

    if imageRegex.search(importPath):
        dataset_type = ImageSequenceType

    elif videoRegex.search(importPath):
        # Look for exisitng video dataset directory
        parentFolder = Folder().findOne({"_id": item["folderId"]})
        userId = parentFolder['creatorId'] or parentFolder['baseParentId']
        user = User().findOne({'_id': ObjectId(userId)})
        foldername = f'Video {item["name"]}'
        dest = Folder().createFolder(parentFolder, foldername, creator=user, reuseExisting=True)
        if dest['created'] < now:
            # Remove the old item, replace it with the new one.
            oldItem = Item().findOne({'folderId': dest['_id'], 'name': item['name']})
            if oldItem is not None:
                Item().remove(oldItem)
        Item().move(item, dest)
        dataset_type = VideoType

    if dataset_type is not None:
        # Update metadata of parent folder
        # FPS is hardcoded for now
        Item().save(item)
        folder = Folder().findOne({"_id": item["folderId"]})
        root, _ = os.path.split(importPath)
        if not asbool(fromMeta(folder, DatasetMarker)):
            folder["meta"].update(
                {
                    TypeMarker: dataset_type,
                    FPSMarker: DefaultVideoFPS,
                    DatasetMarker: True,
                    AssetstoreSourcePathMarker: root,
                    **meta,
                }
            )
            Folder().save(folder)


def process_fs_import(event):
    return process_assetstore_import(event, {AssetstoreSourceMarker: 'filesystem'})


def process_s3_import(event):
    return process_assetstore_import(event, {AssetstoreSourceMarker: 's3'})
