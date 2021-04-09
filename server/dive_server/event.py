from girder.models.folder import Folder
from girder.models.item import Item

from dive_utils.constants import DatasetMarker, ImageSequenceType, csvRegex


def check_existing_annotations(event):
    """
    function for appending the appropriate metadata
    to no-copy import data
    """
    info = event.info
    objectType = info.get("type")
    importPath = info.get("importPath")

    if not importPath or not objectType or objectType != "item":
        return

    if csvRegex.search(importPath):
        # Update file metadata
        item = Item().findOne({"_id": info["id"]})
        item["meta"].update({"detection": str(item["folderId"])})
        Item().save(item)

        # Update metadata of parent folder
        # FPS is hardcoded for now
        folder = Folder().findOne({"_id": item["folderId"]})
        folder["meta"].update(
            {"type": ImageSequenceType, "fps": 30, DatasetMarker: True}
        )
        Folder().save(folder)
