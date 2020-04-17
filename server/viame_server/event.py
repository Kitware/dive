from girder.models.folder import Folder
from girder.models.item import Item

from .utils import validImageFormats, validVideoFormats


def check_existing_annotations(event):
    info = event.info

    if "annotations.csv" in info["importPath"]:
        item = Item().findOne({"_id": info["id"]})
        item["meta"].update({"folderId": str(item["folderId"]), "pipeline": None})
        Item().save(item)

        folder = Folder().findOne({"_id": item["folderId"]})

        # FPS is hardcoded for now
        folder["meta"].update({"type": "image-sequence", "viame": True, "fps": 30})
        Folder().save(folder)


def maybe_mark_folder_for_annotation(event):
    info = event.info

    if info["parentType"] != "folder":
        return

    parent = Folder().findOne({"_id": info["parentId"]})

    fileType = info["mimeType"].split("/")[-1]
    validFileType = fileType in validImageFormats or fileType in validVideoFormats

    if validFileType and parent["meta"].get("viame"):
        parent["meta"]["annotate"] = True
        Folder().save(parent)
