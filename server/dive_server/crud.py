"""General CRUD operations and utilities shared among views"""
from datetime import datetime
import functools
import io
import json
import os
from pathlib import Path
from typing import Callable, Dict, Generator, List, Optional, Tuple, Type

from girder.constants import AccessType
from girder.exceptions import RestException, ValidationException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.model_base import AccessControlledModel
from girder.models.upload import Upload
import pydantic
from pydantic.main import BaseModel
import pymongo
from pymongo.cursor import Cursor

from dive_utils import asbool, constants, fromMeta, models, strNumericCompare
from dive_utils.serializers import kwcoco, viame
from dive_utils.types import GirderModel, GirderUserModel


def get_validated_model(model: BaseModel, **kwargs):
    try:
        return model(**kwargs)
    except pydantic.ValidationError as err:
        raise ValidationException(err)


class PydanticModel(AccessControlledModel):
    schema: Type[BaseModel]

    def initialize(self, name: str, schema: Type[BaseModel]):
        self.name = name
        self.schema = schema
        self.exposeFields(AccessType.READ, schema.schema()['properties'].keys())

    def validate(self, doc: dict):
        validated = self.schema(**doc)
        return validated.dict()

    def create(self, item: BaseModel):
        return self.save(item.dict())


def all_detections_items(folder: GirderModel) -> Cursor:
    """Caller is responsible for verifying access permissions"""
    return (
        Item()
        .find({f"meta.{constants.DetectionMarker}": str(folder['_id'])})
        .sort([("created", -1)])
    )


def detections_item(folder: GirderModel, strict=False) -> Optional[GirderModel]:
    all_items = all_detections_items(folder)
    first_item = next(all_items, None)
    if first_item is None and strict:
        raise RestException(f"No detections for folder {folder['name']}", code=404)
    return first_item


def detections_file(dsFolder: GirderModel, strict=False) -> Optional[GirderModel]:
    """
    Find the Girder file containing the most recent annotation revision
    """
    item = detections_item(dsFolder, strict)
    if item is None and not strict:
        return None
    first_file = next(Item().childFiles(item), None)
    if first_file is None and strict:
        raise RestException(f"No file associated with detection item {item}", code=404)
    return first_file


def get_static_pipelines_path() -> Path:
    pipeline_path = None

    env_pipelines_path = os.getenv("VIAME_PIPELINES_PATH")
    if env_pipelines_path is None:
        raise Exception(
            "No pipeline path specified. "
            "Please set the VIAME_PIPELINES_PATH environment variable.",
        )

    pipeline_path = Path(env_pipelines_path)
    if not pipeline_path.exists():
        raise Exception("Specified pipeline path does not exist!")

    return pipeline_path


def get_or_create_auxiliary_folder(folder, user):
    return Folder().createFolder(folder, "auxiliary", reuseExisting=True, creator=user)


def move_existing_result_to_auxiliary_folder(folder, user):
    auxiliary = get_or_create_auxiliary_folder(folder, user)
    for item in all_detections_items(folder):
        Item().move(item, auxiliary)


def itemIsWebsafeVideo(item: Item) -> bool:
    return fromMeta(item, "codec") == "h264"


def getTrackData(file: Optional[File]) -> Dict[str, dict]:
    if file is None:
        return {}
    if "csv" in file["exts"]:
        (tracks, attributes) = viame.load_csv_as_tracks_and_attributes(
            b"".join(list(File().download(file, headers=False)())).decode("utf-8").splitlines()
        )
        return tracks
    return json.loads(b"".join(list(File().download(file, headers=False)())).decode())


def getTrackAndAttributesFromCSV(file: GirderModel) -> Tuple[dict, dict]:
    if file is None:
        return ({}, {})
    if "csv" in file["exts"]:
        return viame.load_csv_as_tracks_and_attributes(
            b"".join(list(File().download(file, headers=False)())).decode("utf-8").splitlines()
        )
    return ({}, {})


def get_track_and_attributes_from_coco(file: GirderModel) -> Tuple[dict, dict, bool]:
    if file is None:
        return {}, {}, False
    if 'json' in file['exts']:
        coco = json.loads(b"".join(list(File().download(file, headers=False)())).decode())
        if kwcoco.is_coco_json(coco):
            tracks, attributes = kwcoco.load_coco_as_tracks_and_attributes(coco)
            return tracks, attributes, True
    return {}, {}, False


def saveTracks(folder, tracks, user):
    timestamp = datetime.now().strftime("%m-%d-%Y_%H:%M:%S")
    item_name = f"result_{timestamp}.json"

    move_existing_result_to_auxiliary_folder(folder, user)
    newResultItem = Item().createItem(item_name, user, folder)
    Item().setMetadata(
        newResultItem, {constants.DetectionMarker: str(folder["_id"])}, allowNull=True
    )

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


def saveImportAttributes(folder, attributes, user):
    attributes_dict = fromMeta(folder, 'attributes', {})
    # we don't overwrite any existing meta attributes
    for attribute in attributes.values():
        validated: models.Attribute = models.Attribute(**attribute)
        if attribute['key'] not in attributes_dict:
            attributes_dict[str(validated.key)] = validated.dict(exclude_none=True)

    folder['meta']['attributes'] = attributes_dict
    Folder().save(folder)


def verify_dataset(folder: GirderModel):
    """Verify that a given folder is a DIVE dataset"""
    if not asbool(fromMeta(folder, constants.DatasetMarker, False)):
        raise RestException('Source folder is not a valid DIVE dataset', code=404)
    dstype = fromMeta(folder, 'type')
    if dstype not in [constants.ImageSequenceType, constants.VideoType]:
        raise ValueError(f'Source folder is marked as dataset but has invalid type {dstype}')
    if dstype == constants.VideoType:
        fps = fromMeta(folder, 'fps')
        if type(fps) not in [int, float]:
            raise ValueError(f'Video missing numerical fps, found {fps}')
    return True


def process_csv(folder: GirderModel, user: GirderUserModel):
    """If there's a CSV in the folder, process it as a detections object"""
    csvItems = Folder().childItems(
        folder,
        filters={"lowerName": {"$regex": constants.csvRegex}},
        sort=[("created", pymongo.DESCENDING)],
    )
    if csvItems.count() >= 1:
        auxiliary = get_or_create_auxiliary_folder(folder, user)
        file = Item().childFiles(next(csvItems))[0]
        (tracks, attributes) = getTrackAndAttributesFromCSV(file)
        saveTracks(folder, tracks, user)
        saveImportAttributes(folder, attributes, user)
        csvItems.rewind()
        for item in csvItems:
            Item().move(item, auxiliary)
        return True
    return False


def process_json(folder: GirderModel, user: GirderUserModel):
    # Find a json if it exists
    jsonItems = list(
        Folder().childItems(
            folder,
            filters={"lowerName": {"$regex": constants.jsonRegex}},
            sort=[("created", pymongo.DESCENDING)],
        )
    )
    auxiliary = get_or_create_auxiliary_folder(folder, user)
    for item in jsonItems:
        file = Item().childFiles(item)[0]
        tracks, attributes, is_coco = get_track_and_attributes_from_coco(file)
        if is_coco:  # coco json
            saveTracks(folder, tracks, user)
            saveImportAttributes(folder, attributes, user)
            Item().move(item, auxiliary)
        else:  # dive json
            # Perform validation of JSON file input
            possible_annotation_files = list(Item().childFiles(item))
            if len(possible_annotation_files) != 1:
                raise RestException('Expected exactly 1 file')
            for track in getTrackData(possible_annotation_files[0]).values():
                if not isinstance(track, dict):
                    raise RestException(
                        (
                            'Invalid JSON file provided.'
                            ' Please upload a COCO, KWCOCO, VIAME CSV, or DIVE JSON file.'
                        )
                    )
                get_validated_model(models.Track, **track)
            item['meta'][constants.DetectionMarker] = str(folder['_id'])
            Item().save(item)
    if len(jsonItems) > 0:
        move_existing_result_to_auxiliary_folder(folder, user)
        return True
    return False


def getCloneRoot(owner: GirderModel, source_folder: GirderModel):
    """Get the source media folder associated with a clone"""
    verify_dataset(source_folder)
    next_id = fromMeta(source_folder, constants.ForeignMediaIdMarker, False)
    while next_id is not False:
        # Recurse through source folders to find the root, allowing clones of clones
        source_folder = Folder().load(
            next_id,
            level=AccessType.READ,
            user=owner,
        )
        if source_folder is None:
            raise RestException(
                (
                    f"Referenced media source missing. Folder Id {next_id} was not found."
                    " This may be a cloned dataset where the source was deleted."
                ),
                code=404,
            )
        verify_dataset(source_folder)
        next_id = fromMeta(source_folder, constants.ForeignMediaIdMarker, False)
    return source_folder


def valid_images(
    folder: GirderModel,
    user: GirderUserModel,
) -> List[GirderModel]:
    """
    Any time images are used where frame alignment matters, this function must be used
    """
    images = Folder().childItems(
        getCloneRoot(user, folder),
        filters={"lowerName": {"$regex": constants.safeImageRegex}},
    )

    def unwrapItem(item1, item2):
        return strNumericCompare(item1['name'], item2['name'])

    return sorted(
        images,
        key=functools.cmp_to_key(unwrapItem),
    )


def get_annotation_csv_generator(
    folder: GirderModel, user: GirderUserModel, excludeBelowThreshold=False, typeFilter=None
) -> Tuple[str, Callable[[], Generator[str, None, None]]]:
    """
    Get the annotation generator for a folder
    """
    fps = None
    imageFiles = None

    source_type = fromMeta(folder, constants.TypeMarker)
    if source_type == constants.VideoType:
        fps = fromMeta(folder, constants.FPSMarker)
    elif source_type == constants.ImageSequenceType:
        imageFiles = [img['name'] for img in valid_images(folder, user)]

    thresholds = fromMeta(folder, "confidenceFilters", {})
    annotation_file = detections_file(folder)
    track_dict = getTrackData(annotation_file)

    def downloadGenerator():
        for data in viame.export_tracks_as_csv(
            track_dict,
            excludeBelowThreshold,
            thresholds=thresholds,
            filenames=imageFiles,
            fps=fps,
            typeFilter=typeFilter,
        ):
            yield data

    filename = folder["name"] + ".csv"
    return filename, downloadGenerator
