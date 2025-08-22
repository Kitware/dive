from datetime import datetime, timedelta
import os

from bson.objectid import ObjectId
from girder import logger
from girder.models.collection import Collection
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.setting import Setting
from girder.models.user import User
from girder.settings import SettingKey
from girder.utility.mail_utils import renderTemplate, sendMail

from dive_utils import asbool, fromMeta
from dive_utils.constants import (
    AnnotationFileFutureProcessMarker,
    AssetstoreSourceMarker,
    AssetstoreSourcePathMarker,
    DatasetMarker,
    FPSMarker,
    ImageSequenceType,
    LargeImageType,
    MarkForPostProcess,
    TypeMarker,
    VideoType,
    imageRegex,
    largeImageRegEx,
    possibleAnnotationRegex,
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
    elif largeImageRegEx.search(importPath):
        dataset_type = LargeImageType
        parentFolder = Folder().findOne({"_id": item["folderId"]})
        userId = parentFolder['creatorId'] or parentFolder['baseParentId']
        userId = parentFolder['creatorId'] or parentFolder['baseParentId']
        user = User().findOne({'_id': ObjectId(userId)})
        # remove extension from item name
        base_name = os.path.splitext(item['name'])[0]
        # Need to create a new DIVE Dataset Folder for each file if the Setting says we should
        foldername = base_name
        # resuse existing folder if it already exists with same name
        dest = Folder().createFolder(parentFolder, foldername, creator=user, reuseExisting=True)
        # resuse existing folder if it already exists with same name
        dest = Folder().createFolder(parentFolder, foldername, creator=user, reuseExisting=True)
        now = datetime.now()
        if now - dest['created'] > timedelta(hours=1):
            # Remove the old  referenced item, replace it with the new one.
            oldItem = Item().findOne({'folderId': dest['_id'], 'name': item['name']})
            if oldItem is not None:
                Item().remove(oldItem)
        Item().move(item, dest)
    elif videoRegex.search(importPath):
        # Look for existing video dataset directory
        parentFolder = Folder().findOne({"_id": item["folderId"]})
        userId = parentFolder['creatorId'] or parentFolder['baseParentId']
        user = User().findOne({'_id': ObjectId(userId)})
        base_name = os.path.splitext(item['name'])[0]
        foldername = base_name
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
    elif possibleAnnotationRegex.search(importPath):
        # Look for parent folder with same name
        parentFolder = Folder().findOne({"_id": item["folderId"]})
        userId = parentFolder['creatorId'] or parentFolder['baseParentId']
        user = User().findOne({'_id': ObjectId(userId)})
        base_name = os.path.splitext(item['name'])[0]
        foldername = base_name
        # check if folder with foldername exists in the parentFolder location this would be a video folder then
        possible_video_folder = Folder().findOne(
            {'parentId': parentFolder['_id'], 'name': foldername}
        )
        if possible_video_folder is not None:
            # Move the annotation file into the video folder
            Item().move(item, possible_video_folder)
            return

        parent_type_marker = parentFolder['meta'].get(TypeMarker, False)
        if not parent_type_marker:
            # Files haven't been process yet so we don't know if this annotation file is for a video or a image sequence
            meta = {
                AnnotationFileFutureProcessMarker: True,
            }
            item['meta'].update(meta)
            item.save()
            # Mark the file for future processing to determine if it is a video or image sequence
            return

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


def process_dangling_annotation_files(folder, user):
    annotation_items = Item().find(
        {'folderId': folder['_id'], f'meta.{AnnotationFileFutureProcessMarker}': True}
    )
    for item in annotation_items:
        # check if the parent folder of the annotation item is of type image or large image
        parent_folder_id = item['folderId']
        parent_folder = Folder().findOne({'_id': parent_folder_id})
        if parent_folder_id.get('meta', {}).get(TypeMarker, None) in [
            ImageSequenceType,
            LargeImageType,
        ]:
            item['meta'][AnnotationFileFutureProcessMarker] = False
            Item().save(item)
            continue
        # Check if the corresponding video folder exists
        base_name = os.path.splitext(item['name'])[0]
        video_folder = Folder().findOne({'name': base_name, f'meta.{TypeMarker}': VideoType})
        if video_folder is not None:
            # Move the annotation file into the video folder
            item['meta'][AnnotationFileFutureProcessMarker] = False
            Item().save(item)
            Item().move(item, video_folder)
            continue


def convert_video_recursive(folder, user):
    subFolders = list(Folder().childFolders(folder, 'folder', user))
    for child in subFolders:
        if child.get('meta', {}).get(MarkForPostProcess, False):
            child['meta']['MarkForPostProcess'] = False
            Folder().save(child)
            crud_rpc.postprocess(user, child, False, True)
        convert_video_recursive(child, user)


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
            userId = destinationFolder['creatorId'] or destinationFolder['baseParentId']
            user = User().findOne({'_id': ObjectId(userId)})
            process_dangling_annotation_files(destinationFolder, user)
            convert_video_recursive(destinationFolder, user)
        if self.destinationType == 'collection' and self.destinationId is not None:
            destinationCollection = Collection().findOne({"_id": ObjectId(self.destinationId)})
            userId = destinationCollection['creatorId'] or destinationCollection['baseParentId']
            user = User().findOne({'_id': ObjectId(userId)})
            child_folders = Folder().childFolders(self.destinationId, 'collection')
            for child in child_folders:
                process_dangling_annotation_files(child, user)
                convert_video_recursive(child, user)
        self.destinationId = None
        self.destinationType = None


def process_fs_import(event):
    return process_assetstore_import(event, {AssetstoreSourceMarker: 'filesystem'})


def process_s3_import(event):
    return process_assetstore_import(event, {AssetstoreSourceMarker: 's3'})
