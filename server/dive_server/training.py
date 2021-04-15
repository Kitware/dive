import json

from girder.models.assetstore import Assetstore
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload
from girder.models.user import User

from dive_server.serializers import viame
from dive_utils import fromMeta
from dive_utils.constants import (
    FPSMarker,
    ImageSequenceType,
    TypeMarker,
    ViameDataFolderName,
    VideoType,
    safeImageRegex,
)
from dive_utils.types import GirderModel

TrainingOutputFolderName = "VIAME Training Results"


def training_output_folder(user: User):
    """Ensure that the user has a training results folder."""

    viameFolder = Folder().createFolder(
        user,
        ViameDataFolderName,
        description="VIAME data storage.",
        parentType="user",
        public=False,
        creator=user,
        reuseExisting=True,
    )

    return Folder().createFolder(
        viameFolder,
        TrainingOutputFolderName,
        description="Results from VIAME model training are placed here.",
        public=False,
        creator=user,
        reuseExisting=True,
    )


def ensure_csv_detections_file(
    folder: Folder, detection_item: Item, user: User
) -> GirderModel:
    """
    Ensures that the detection item has a file which is a csv.
    Attach the newly created .csv to the existing detection_item.
    :returns: the file document.
    """

    file = Item().childFiles(detection_item)[0]
    if "csv" in file["exts"]:
        return file

    filename = ".".join([file["name"].split(".")[:-1][0], "csv"])
    track_dict = json.loads(
        b"".join(list(File().download(file, headers=False)())).decode()
    )

    fps = None
    imageFiles = None
    source_type = fromMeta(folder, TypeMarker)
    if source_type == VideoType:
        fps = fromMeta(folder, FPSMarker)
    elif source_type == ImageSequenceType:
        imageFiles = [
            f['name']
            for f in Folder()
            .childItems(folder, filters={"lowerName": {"$regex": safeImageRegex}})
            .sort("lowerName")
        ]

    thresholds = fromMeta(folder, "confidenceFilters", {})
    csv_string = "".join(
        (
            line
            for line in viame.export_tracks_as_csv(
                track_dict,
                excludeBelowThreshold=True,
                thresholds=thresholds,
                filenames=imageFiles,
                fps=fps,
            )
        )
    )
    csv_bytes = csv_string.encode()

    assetstore = Assetstore().findOne({"_id": file["assetstoreId"]})
    new_file = File().findOne({"name": filename}) or File().createFile(
        user, detection_item, filename, len(csv_bytes), assetstore
    )

    upload = Upload().createUploadToFile(new_file, user, len(csv_bytes))
    new_file = Upload().handleChunk(upload, csv_bytes)

    return new_file
