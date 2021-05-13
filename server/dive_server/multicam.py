from typing import Any, Dict

from girder.models import upload
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.token import Token

import dive_utils
from dive_tasks.tasks import UPGRADE_JOB_DEFAULT_URLS, convert_images, convert_video
from dive_utils.constants import (
    imageRegex,
    safeImageRegex,
    validVideoFormats,
    videoRegex,
)
from dive_utils.models import MultiCamArgs

from .transforms import GetPathFromItemId
from .utils import get_or_create_auxiliary_folder


def process_multicam_folder(user, folder, args: MultiCamArgs):
    output_meta: Dict[str, Any]
    output_meta = {'display': args.defaultDisplay, 'cameras': {}}
    for key in args.folderList.keys():
        upload_folder = args.folderList[key]
        girder_folder = Folder().createFolder(folder, str(key))
        girder_folder["meta"]["multiCamera"] = True
        Folder().save(girder_folder)
        data_type = 'image-sequence'
        # If we have a single file most likely it is a video do a check on extension
        if len(upload_folder) == 1 and upload_folder[0].endswith(
            tuple(validVideoFormats)
        ):
            data_type = 'video'
            file_item = Item().findOne(
                {'folderId': folder['_id'], 'name': upload_folder[0]}
            )
            Item().move(file_item, girder_folder)
        else:
            for item in upload_folder:
                file_item = Item().findOne({'folderId': folder['_id'], 'name': item})
                Item().move(file_item, girder_folder)

        output_meta["cameras"][key] = {
            'originalBaseId': girder_folder['_id'],
            'type': data_type,
        }
        transcode_items(user, girder_folder)
    calibration_file = Item().findOne(
        {'parentId': folder['_id'], "lowerName": args.calibrationFile}
    )
    if calibration_file is not None:
        output_meta['calibration'] = calibration_file['_id']
    return output_meta


def transcode_items(user, folder):
    auxiliary = get_or_create_auxiliary_folder(folder, user)
    token = Token().createToken(user=user, days=2)
    # transcode VIDEO if necessary
    videoItems = Folder().childItems(
        folder, filters={"lowerName": {"$regex": videoRegex}}
    )
    for item in videoItems:
        convert_video.delay(
            path=GetPathFromItemId(str(item["_id"])),
            folderId=str(item["folderId"]),
            auxiliaryFolderId=auxiliary["_id"],
            itemId=str(item["_id"]),
            girder_job_title=(
                "Converting {} to a web friendly format".format(str(item["_id"]))
            ),
            girder_client_token=str(token["_id"]),
        )

    # transcode IMAGERY if necessary
    imageItems = Folder().childItems(
        folder, filters={"lowerName": {"$regex": imageRegex}}
    )
    safeImageItems = Folder().childItems(
        folder, filters={"lowerName": {"$regex": safeImageRegex}}
    )

    if imageItems.count() > safeImageItems.count():
        convert_images.delay(
            folderId=folder["_id"],
            girder_client_token=str(token["_id"]),
            girder_job_title=(f"Converting {folder['_id']} to a web friendly format",),
        )
