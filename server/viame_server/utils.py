import io
import json
import re
from datetime import datetime
from pathlib import Path

from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.file import File
from girder.models.upload import Upload
from girder.models.assetstore import Assetstore

from viame_server.serializers import viame

from typing import List, Dict
from typing_extensions import TypedDict

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

TrainingOutputFolderName = "Training Results"
DefaultTrainingConfiguration = "train_netharn_cascade.viame_csv.conf"


class TrainingConfigurationDescription(TypedDict):
    configs: List[str]
    default: str


class PipelineDescription(TypedDict):
    name: str
    type: str
    pipe: str


class PipelineDict(TypedDict):
    pipes: List[PipelineDescription]
    description: str


def load_pipelines(pipeline_paths):
    main_pipeline_path, trained_pipeline_path = pipeline_paths

    pipelist = []
    if main_pipeline_path is not None:
        allowed = r"^detector_.+|tracker_.+"
        disallowed = r".*local.*|detector_svm_models.pipe|tracker_svm_models.pipe"
        pipelist.extend(
            [
                path.name
                for path in main_pipeline_path.glob("./*.pipe")
                if re.match(allowed, path.name) and not re.match(disallowed, path.name)
            ]
        )

    if trained_pipeline_path is not None:
        pipelist.extend(
            [path.name for path in trained_pipeline_path.iterdir() if path.is_dir()]
        )

    pipedict: Dict[str, PipelineDict] = {}
    for pipe in pipelist:
        pipe_type, *nameparts = pipe.replace(".pipe", "").split("_")
        pipe_info: PipelineDescription = {
            "name": " ".join(nameparts),
            "type": pipe_type,
            "pipe": pipe,
        }

        if pipe_type in pipedict:
            pipedict[pipe_type]["pipes"].append(pipe_info)
        else:
            pipedict[pipe_type] = {"pipes": [pipe_info], "description": ""}

    return pipedict


def load_training_configurations(pipeline_paths) -> TrainingConfigurationDescription:
    main_pipeline_path: Path
    main_pipeline_path, _ = pipeline_paths

    configurations = [path.name for path in main_pipeline_path.glob("./*.conf")]

    return {
        "configs": configurations,
        "default": DefaultTrainingConfiguration,
    }


def get_or_create_auxiliary_folder(folder, user):
    return Folder().createFolder(folder, "auxiliary", reuseExisting=True, creator=user)


def move_existing_result_to_auxiliary_folder(folder, user):
    auxiliary = get_or_create_auxiliary_folder(folder, user)

    existingResultItems = Item().find(
        {"meta.detection": str(folder["_id"]), "folderId": folder["_id"]}
    )
    for item in existingResultItems:
        Item().move(item, auxiliary)


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


def itemIsWebsafeVideo(item: Item) -> bool:
    return item.get("meta", {}).get("codec") == "h264"


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
