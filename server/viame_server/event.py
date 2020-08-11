from girder.models.folder import Folder
from girder.models.item import Item

from viame_server.utils import ImageSequenceType, validImageFormats


def check_existing_annotations(event):
    """
    function for appending the appropriate metadata
    to no-copy import data
    """
    info = event.info

    if "annotations.csv" in info["importPath"]:
        item = Item().findOne({"_id": info["id"]})
        item["meta"].update({"detection": str(item["folderId"])})
        Item().save(item)

        folder = Folder().findOne({"_id": item["folderId"]})

        # FPS is hardcoded for now
        folder["meta"].update(
            {"type": ImageSequenceType, "fps": 30,}
        )
        Folder().save(folder)
