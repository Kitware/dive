import json
import re
from typing import List

from girder.models.assetstore import Assetstore
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload
from typing_extensions import TypedDict

from viame_server.constants import (
    ImageSequenceType,
    ViameDataFolderName,
    VideoType,
    safeImageRegex,
)
from viame_server.pipelines import DisallowedStaticPipelines, get_static_pipelines_path
from viame_server.serializers import viame

TrainingOutputFolderName = "VIAME Training Results"
DefaultTrainingConfiguration = "train_netharn_cascade.viame_csv.conf"
AllowedTrainingConfigs = r".*\.viame_csv\.conf$"


class TrainingConfigurationDescription(TypedDict):
    configs: List[str]
    default: str


def load_training_configurations() -> TrainingConfigurationDescription:
    """Load existing training configs."""

    main_pipeline_path = get_static_pipelines_path()
    configurations = sorted([path.name for path in main_pipeline_path.glob("./*.conf")])
    configurations = [c for c in configurations if re.match(AllowedTrainingConfigs, c)]

    return {
        "configs": configurations,
        "default": DefaultTrainingConfiguration,
    }


def training_output_folder(user):
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


def csv_detection_file(folder, detection_item, user):
    """
    Ensures that the detection item has a file which is a csv.

    Returns the file document.
    """

    file = Item().childFiles(detection_item)[0]
    if "csv" in file["exts"]:
        return file

    filename = ".".join([file["name"].split(".")[:-1][0], "csv"])
    track_dict = json.loads(
        b"".join(list(File().download(file, headers=False)())).decode()
    )

    foldermeta = folder.get('meta', {})
    fps = None
    imageFiles = None
    source_type = foldermeta.get('type', None)
    if source_type == VideoType:
        fps = foldermeta.get('fps', None)
    elif source_type == ImageSequenceType:
        imageFiles = [
            f['name']
            for f in Folder()
            .childItems(folder, filters={"lowerName": {"$regex": safeImageRegex}})
            .sort("lowerName")
        ]

    thresholds = folder.get("meta", {}).get("confidenceFilters", {})
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
