import io
import json
import re
from datetime import datetime
from typing import Dict

import cherrypy
from girder.api.rest import setContentDisposition, setRawResponse, setResponseHeader
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload

from viame_server.serializers import viame

ImageSequenceType = "image-sequence"
VideoType = "video"

webValidImageFormats = {"png", "jpg", "jpeg"}
validImageFormats = {*webValidImageFormats, "tif", "tiff", "sgi", "bmp", "pgm"}
validVideoFormats = {"mp4", "avi", "mov", "mpg"}

videoRegex = re.compile("(\." + "|\.".join(validVideoFormats) + ')$', re.IGNORECASE)
imageRegex = re.compile("(\." + "|\.".join(validImageFormats) + ')$', re.IGNORECASE)
safeImageRegex = re.compile(
    "(\." + "|\.".join(webValidImageFormats) + ')$', re.IGNORECASE
)
csvRegex = re.compile("\.csv$", re.IGNORECASE)
ymlRegex = re.compile("\.ya?ml$", re.IGNORECASE)

ImageMimeTypes = {
    "image/png",
    "image/jpeg",
    "image/tiff",
    "image/bmp",
    "image/x-portable-anymap",
    "image/x-portable-bitmap",
    "image/x-portable-graymap",
    "image/x-rgb",
}

VideoMimeTypes = {
    "video/mpeg",
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
}

# Ad hoc way to guess the FPS of an Image Sequence based on file names
# Currently not being used, can only be used once you know that all items
# have been imported.
def determine_image_sequence_fps(folder):
    items = Item().find({"folderId": folder["_id"]})

    start = None
    current = None

    item_length = 0
    for item in items:
        item_length += 1
        name = item["name"]

        try:
            _, two, three, four, _ = name.split(".")
            seconds = two[:2] * 3600 + two[2:4] * 60 + two[4:]

            if not start:
                start = int(seconds)
            current = int(seconds)

        except ValueError:
            if "annotations.csv" not in name:
                return None

    total = current - start
    return round(item_length / total)


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
