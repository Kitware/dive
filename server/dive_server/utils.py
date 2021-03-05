import io
import json
import os
from datetime import datetime
from typing import Dict, List

from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload

from dive_server.serializers import viame


def get_or_create_auxiliary_folder(folder, user):
    return Folder().createFolder(folder, "auxiliary", reuseExisting=True, creator=user)


def move_existing_result_to_auxiliary_folder(folder, user):
    auxiliary = get_or_create_auxiliary_folder(folder, user)

    existingResultItems = Item().find(
        {"meta.detection": str(folder["_id"]), "folderId": folder["_id"]}
    )
    for item in existingResultItems:
        Item().move(item, auxiliary)


def itemIsWebsafeVideo(item: Item) -> bool:
    return item.get("meta", {}).get("codec") == "h264"


def getTrackData(file: File) -> Dict[str, dict]:
    if file is None:
        return {}
    if "csv" in file["exts"]:
        return viame.load_csv_as_tracks(
            b"".join(list(File().download(file, headers=False)()))
            .decode("utf-8")
            .splitlines()
        )
    return json.loads(b"".join(list(File().download(file, headers=False)())).decode())


def saveTracks(folder, tracks, user):
    timestamp = datetime.now().strftime("%m-%d-%Y_%H:%M:%S")
    item_name = f"result_{timestamp}.json"

    move_existing_result_to_auxiliary_folder(folder, user)
    newResultItem = Item().createItem(item_name, user, folder)
    Item().setMetadata(newResultItem, {"detection": str(folder["_id"])}, allowNull=True)

    json_bytes = json.dumps(tracks).encode()
    byteIO = io.BytesIO(json_bytes)
    Upload().uploadFromFile(
        byteIO,
        len(json_bytes),
        item_name,
        parentType="item",
        parent=newResultItem,
        user=user,
        mimeType="application/json",
    )
