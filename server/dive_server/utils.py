import io
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Tuple

from girder.exceptions import RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload
from pymongo.cursor import Cursor

from dive_server.serializers import models, viame
from dive_utils.types import GirderModel


def all_detections_items(folder: Folder) -> Cursor:
    """caller is responsible for verifying access permissions"""
    return Item().find({"meta.detection": str(folder['_id'])}).sort([("created", -1)])


def detections_item(folder: Folder, strict=False) -> Optional[GirderModel]:
    all_items = all_detections_items(folder)
    first_item = next(all_items, None)
    if first_item is None and strict:
        raise RestException(f"No detections for folder {folder['name']}")
    return first_item


def detections_file(folder: Folder, strict=False) -> Optional[GirderModel]:
    item = detections_item(folder, strict)
    if item is None and not strict:
        return None
    first_file = next(Item().childFiles(item), None)
    if first_file is None and strict:
        raise RestException(f"No file associated with detection item {item}")
    return first_file


def get_static_pipelines_path() -> Path:
    pipeline_path = None

    env_pipelines_path = os.getenv("VIAME_PIPELINES_PATH")
    if env_pipelines_path is None:
        raise Exception(
            "No pipeline path specified. "
            "Please set the VIAME_PIPELINES_PATH environment variable.",
        )

    pipeline_path = Path(env_pipelines_path)
    if not pipeline_path.exists():
        raise Exception("Specified pipeline path does not exist!")

    return pipeline_path


def get_or_create_auxiliary_folder(folder, user):
    return Folder().createFolder(folder, "auxiliary", reuseExisting=True, creator=user)


def move_existing_result_to_auxiliary_folder(folder, user):
    auxiliary = get_or_create_auxiliary_folder(folder, user)
    for item in all_detections_items(folder):
        Item().move(item, auxiliary)


def itemIsWebsafeVideo(item: Item) -> bool:
    return item.get("meta", {}).get("codec") == "h264"


def getTrackData(file: Optional[File]) -> Dict[str, dict]:
    if file is None:
        return {}
    if "csv" in file["exts"]:
        (tracks, attributes) = viame.load_csv_as_tracks_and_attributes(
            b"".join(list(File().download(file, headers=False)()))
            .decode("utf-8")
            .splitlines()
        )
        return tracks
    return json.loads(b"".join(list(File().download(file, headers=False)())).decode())


def getTrackAndAttributesFromCSV(file: File) -> Tuple[dict, dict]:
    if file is None:
        return ({}, {})
    if "csv" in file["exts"]:
        return viame.load_csv_as_tracks_and_attributes(
            b"".join(list(File().download(file, headers=False)()))
            .decode("utf-8")
            .splitlines()
        )
    return ({}, {})


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


def saveCSVImportAttributes(folder, attributes, user):
    attributes_dict = {}
    if 'attributes' in folder['meta']:
        attributes_dict = folder['meta']['attributes']
    # we dont overwrite any existing meta attributes
    for attribute in attributes.values():
        validated: models.Attribute = models.Attribute(**attribute)
        if attribute['key'] not in attributes_dict:
            attributes_dict[str(validated.key)] = validated.dict(exclude_none=True)

    folder['meta']['attributes'] = attributes_dict
    Folder().save(folder)
