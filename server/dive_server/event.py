from datetime import datetime, timedelta, timezone
import logging
import os

from bson.objectid import ObjectId
import cherrypy
from girder.api.rest import getApiUrl
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.setting import Setting
from girder.models.token import Token
from girder.models.user import User
from girder.settings import SettingKey
from girder.utility.mail_utils import renderTemplate, sendMail
from girder_jobs.models.job import Job
from girder_plugin_worker.utils import getWorkerApiUrl

from dive_tasks.dive_batch_postprocess import DIVEBatchPostprocessTaskParams
from dive_utils import asbool, frame_metadata, fromMeta
from dive_utils.constants import (
    AnnotationFileFutureProcessMarker,
    AssetstoreSourceMarker,
    AssetstoreSourcePathMarker,
    DatasetMarker,
    FPSMarker,
    FrameMetadataFileMarker,
    ImageSequenceType,
    LargeImageType,
    MarkForPostProcess,
    MetadataFileItemIdMarker,
    MetadataFileOriginalNameMarker,
    ProcessedMarker,
    TypeMarker,
    VideoType,
    imageRegex,
    largeImageRegEx,
    metadataFileRegex,
    possibleAnnotationRegex,
    videoRegex,
)

logger = logging.getLogger(__name__)


def send_new_user_email(event):
    try:
        info = event.info
        email = info.get('email')
        brandName = Setting().get(SettingKey.BRAND_NAME)
        rendered = renderTemplate('welcome.mako')
        sendMail(f'Welcome to {brandName}', rendered, [email])
    except Exception:
        logger.exception("Failed to send new user email")


def _rename_item_and_files(item, new_name: str):
    """Rename a Girder item and its child file documents to *new_name*, then save."""
    if item.get('name') != new_name:
        item['name'] = new_name
        item['lowerName'] = new_name.lower()
    item = Item().save(item)
    for child_file in Item().childFiles(item):
        if child_file.get('name') != new_name:
            child_file['name'] = new_name
            File().save(child_file)
    return item


def _remove_existing_frame_metadata(video_folder, keep_item_id=None):
    """Remove reserved-name frame metadata items already in the video dataset folder."""
    existing = list(
        Folder().childItems(
            video_folder,
            filters=frame_metadata.frame_metadata_source_name_query(),
        )
    )
    keep_id = str(keep_item_id) if keep_item_id is not None else None
    for old in existing:
        if keep_id is not None and str(old['_id']) == keep_id:
            continue
        Item().remove(old)


def _attach_frame_metadata_to_folder(video_folder, item, name: str):
    """Record *item* as the folder's metadata attachment (reimport-safe without postprocess)."""
    folder = Folder().findOne({'_id': video_folder['_id']})
    if folder is None:
        folder = video_folder
    folder.setdefault('meta', {})
    folder['meta'][MetadataFileItemIdMarker] = str(item['_id'])
    folder['meta'][MetadataFileOriginalNameMarker] = name
    Folder().save(folder)


def _place_video_paired_metadata(item, video_folder, ext: str):
    """Replace any existing frame metadata with this sidecar in the video folder.

    Renames ``{stem}[-_]metadata.{ext}`` to ``frame_metadata.{ext}``, removes prior reserved-name
    sidecars in the folder, tags the item, and points the folder attachment markers at it so a
    reimport works even when MarkForPostProcess does not run again.
    """
    new_name = frame_metadata.canonical_frame_metadata_name(ext)
    _remove_existing_frame_metadata(video_folder, keep_item_id=item['_id'])
    item['meta'][AnnotationFileFutureProcessMarker] = False
    item['meta'][FrameMetadataFileMarker] = 'true'
    item['meta'][ProcessedMarker] = True
    item = _rename_item_and_files(item, new_name)
    Item().move(item, video_folder)
    _attach_frame_metadata_to_folder(video_folder, item, new_name)
    return item


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
    elif videoRegex.search(importPath):
        # Look for existing video dataset directory
        parentFolder = Folder().findOne({"_id": item["folderId"]})
        userId = parentFolder['creatorId'] or parentFolder['baseParentId']
        user = User().findOne({'_id': ObjectId(userId)})
        base_name = os.path.splitext(item['name'])[0]
        foldername = base_name
        # resuse existing folder if it already exists with same name
        dest = Folder().createFolder(parentFolder, foldername, creator=user, reuseExisting=True)
        created = dest['created']
        if getattr(created, 'tzinfo', None) is None:
            created = created.replace(tzinfo=timezone.utc)
        else:
            created = created.astimezone(timezone.utc)
        now = datetime.now(timezone.utc)
        if now - created > timedelta(hours=1):
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
    elif metadataFileRegex.search(importPath) or possibleAnnotationRegex.search(importPath):
        if frame_metadata.is_frame_metadata_source_name(item['name']):
            # Declared frame metadata sidecars stay in place for read-time discovery.
            # Tag the item for Girder UI; process_items records the folder locator later.
            Item().setMetadata(item, {FrameMetadataFileMarker: 'true'})
            return

        paired = frame_metadata.parse_video_paired_metadata_name(item['name'])
        if paired is not None:
            # ``{videoStem}[-_]metadata.{csv|json|txt}`` → video folder as frame_metadata.{ext}
            video_stem, ext = paired
            parentFolder = Folder().findOne({"_id": item["folderId"]})
            possible_video_folder = Folder().findOne(
                {'parentId': parentFolder['_id'], 'name': video_stem}
            )
            if possible_video_folder is not None:
                _place_video_paired_metadata(item, possible_video_folder, ext)
                return

            parent_type_marker = parentFolder['meta'].get(TypeMarker, False)
            if not parent_type_marker:
                # Video folder may arrive later in the same import; defer relocate+rename.
                item['meta'][AnnotationFileFutureProcessMarker] = True
                Item().save(item)
            return

        # Plain annotations are json/csv only; .txt that is not frame metadata is ignored.
        if not possibleAnnotationRegex.search(importPath):
            return

        # Look for parent folder with same name
        parentFolder = Folder().findOne({"_id": item["folderId"]})
        userId = parentFolder['creatorId'] or parentFolder['baseParentId']
        user = User().findOne({'_id': ObjectId(userId)})
        base_name = os.path.splitext(item['name'])[0]
        foldername = base_name
        # check if folder with foldername exists in the parentFolder location;
        # this would be a video folder then
        possible_video_folder = Folder().findOne(
            {'parentId': parentFolder['_id'], 'name': foldername}
        )
        if possible_video_folder is not None:
            # Move the annotation file into the video folder
            Item().move(item, possible_video_folder)
            return

        parent_type_marker = parentFolder['meta'].get(TypeMarker, False)
        if not parent_type_marker:
            # Files haven't been process yet so we don't know if this annotation file
            # is for a video or a image sequence
            meta = {
                AnnotationFileFutureProcessMarker: True,
            }
            item['meta'].update(meta)

            Item().save(item)
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
                    FPSMarker: -1,  # auto: video uses media FPS; image sequence defaults to 1
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
        if parent_folder.get('meta', {}).get(TypeMarker, None) in [
            ImageSequenceType,
            LargeImageType,
        ]:
            item['meta'][AnnotationFileFutureProcessMarker] = False
            Item().save(item)
            continue

        paired = frame_metadata.parse_video_paired_metadata_name(item['name'])
        if paired is not None:
            video_stem, ext = paired
            video_folder = Folder().findOne(
                {
                    'parentId': parent_folder_id,
                    'name': video_stem,
                    f'meta.{TypeMarker}': VideoType,
                }
            )
            if video_folder is not None:
                _place_video_paired_metadata(item, video_folder, ext)
            continue

        # Check if the corresponding video folder exists
        base_name = os.path.splitext(item['name'])[0]
        video_folder = Folder().findOne(
            {'parentId': parent_folder_id, 'name': base_name, f'meta.{TypeMarker}': VideoType}
        )
        if video_folder is not None:
            # Move the annotation file into the video folder
            item['meta'][AnnotationFileFutureProcessMarker] = False
            Item().save(item)
            Item().move(item, video_folder)
            continue
    for child in Folder().childFolders(folder, 'folder', user):
        process_dangling_annotation_files(child, user)


def _job_cherrypy_callback_url() -> str:
    """REST handlers have a CherryPy request; Celery workers do not."""
    try:
        return cherrypy.url()
    except Exception:
        return getWorkerApiUrl()


def convert_video_recursive(folder, user):
    token = Token().createToken(user=user, days=2)

    dive_batch_postprocess_task_params: DIVEBatchPostprocessTaskParams = {
        "source_folder_id": str(folder['_id']),
        "skipJobs": False,  # Allow jobs to run (transcoding, etc.)
        "skipTranscoding": True,  # Skip transcoding if not needed
        "additive": False,
        "additivePrepend": '',
        "userId": str(user['_id']),
        "user_login": str(user.get('login', 'unknown')),
        "girderToken": str(token['_id']),
        "girderApiUrl": getWorkerApiUrl(),
    }
    if not Setting().get('worker.api_url'):
        Setting().set('worker.api_url', getApiUrl())
    job = Job().createLocalJob(
        module='dive_tasks.dive_batch_postprocess',
        function='batchPostProcessingTaskLauncher',
        kwargs={'params': dive_batch_postprocess_task_params, 'url': _job_cherrypy_callback_url()},
        title='Batch process Dive Batch Postprocess',
        type='DIVE Batch Postprocess',
        user=user,
        public=True,
        asynchronous=True,
    )
    # Run on the ``local`` Celery queue instead of scheduleLocal + daemon thread.
    # importDataTask completes right after this; a daemon thread is often killed or
    # never updates the job, so the document stays INACTIVE.
    from dive_tasks.local_tasks import run_batch_postprocess_job

    run_batch_postprocess_job.delay(str(job['_id']))


def run_post_assetstore_import(event):
    """
    Run after Assetstore.importData completes.

    Bound on Celery ``local`` workers via ``dive_tasks.worker_girder_events``.
    Admin and bucket-notification imports both run import in that process, not on Girder web.
    """
    info = event.info
    parent = info.get('parent')
    parentType = info.get('parentType')
    user = info.get('user')
    if not parent or not parentType or not user:
        return
    userId = parent['creatorId'] or parent['baseParentId']
    owner = User().findOne({'_id': ObjectId(userId)})
    if parentType == 'folder':
        process_dangling_annotation_files(parent, owner)
        convert_video_recursive(parent, owner)
    elif parentType in ('collection', 'user'):
        child_folders = Folder().find({'parentId': parent['_id']})
        for child in child_folders:
            process_dangling_annotation_files(child, owner)
            convert_video_recursive(child, owner)


def process_fs_import(event):
    return process_assetstore_import(event, {AssetstoreSourceMarker: 'filesystem'})


def process_s3_import(event):
    return process_assetstore_import(event, {AssetstoreSourceMarker: 's3'})
