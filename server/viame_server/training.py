import json
from typing import List

from girder.models.assetstore import Assetstore
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload
from typing_extensions import TypedDict

from viame_server.pipelines import get_static_pipelines_path
from viame_server.serializers import viame

TrainingOutputFolderName = "Training Results"
DefaultTrainingConfiguration = "train_netharn_cascade.viame_csv.conf"


class TrainingConfigurationDescription(TypedDict):
    configs: List[str]
    default: str


def load_training_configurations() -> TrainingConfigurationDescription:
    """Load existing training configs."""

    main_pipeline_path = get_static_pipelines_path()
    configurations = [path.name for path in main_pipeline_path.glob("./*.conf")]

    return {
        "configs": configurations,
        "default": DefaultTrainingConfiguration,
    }


def training_output_folder(folder, user):
    """Ensure that `folder` has a "Training Output" folder"""
    return Folder().createFolder(
        folder, TrainingOutputFolderName, creator=user, reuseExisting=True
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

    thresholds = folder.get("meta", {}).get("confidenceFilters", {})
    csv_string = "".join(
        (
            line
            for line in viame.export_tracks_as_csv(
                track_dict, excludeBelowThreshold=True, thresholds=thresholds
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
