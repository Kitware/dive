from girder.models.folder import Folder
from girder.models.item import Item

from viame_server.utils import (
    validImageFormats,
    ImageSequenceType,
)


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
        folder["meta"].update({
            "type": ImageSequenceType,
            "fps": 30,
            "viame": True,
        })
        Folder().save(folder)


def maybe_mark_folder_for_annotation(event):
    """
    event handler for attaching appropriate metadata
    to user-uploaded data
    """
    info = event.info

    if "parentType" not in info or info["parentType"] != "folder":
        return

    parent = Folder().findOne({"_id": info["parentId"]})

    # We can only mark images as able to annotate
    # Videos must be marked by the annotation pipeline.
    meta = parent.get("meta", {})
    if meta.get("type") == ImageSequenceType and meta.get("viame"):
        fileType = info["mimeType"].split("/")[-1]

        if fileType in validImageFormats:
            parent["meta"]["annotate"] = True
            Folder().save(parent)
