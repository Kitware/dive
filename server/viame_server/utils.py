import cherrypy
from girder.api.rest import setContentDisposition, setRawResponse, setResponseHeader
from girder.models.folder import Folder
from girder.models.item import Item

ImageSequenceType = "image-sequence"
VideoType = "video"

webValidImageFormats = {"png", "jpg", "jpeg"}
validImageFormats = {*webValidImageFormats, "tif", "tiff", "sgi", "bmp", "pgm"}
validVideoFormats = {"mp4", "avi", "mov", "mpg"}

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

    existingResultItem = Item().findOne(
        {"meta.detection": str(folder["_id"]), "folderId": folder["_id"]}
    )
    if existingResultItem:
        Item().move(existingResultItem, auxiliary)


def itemIsWebsafeVideo(item: Item) -> bool:
    return item.get("meta", {}).get("codec") == "h264"
