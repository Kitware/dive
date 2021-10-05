"""General CRUD operations and utilities shared among views"""
from datetime import datetime
from enum import Enum
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
from pymongo.cursor import Cursor

from dive_utils import asbool, constants, fromMeta, models, strNumericCompare
from dive_utils.serializers import kwcoco, viame
from dive_utils.types import GirderModel, GirderUserModel


class FileType(Enum):
    DIVE_JSON = 1
    VIAME_CSV = 2
    COCO_JSON = 3
    DIVE_CONF = 4


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


def get_data_by_type(
    file: Optional[GirderModel], as_type: Optional[FileType] = None
) -> Tuple[Optional[FileType], dict, dict]:
    """
    Given an arbitrary Girder file model, figure out what kind of file it is and
    parse it appropriately.

    :as_type: bypass type discovery (potentially expensive) if caller is certain about type
    """
    if file is None:
        return None, {}, {}
    file_string = b"".join(list(File().download(file, headers=False)())).decode()
    data_dict = {}

    # If the caller has not specified a type, try to discover it
    if as_type is None:
        if file['exts'][-1] == 'csv':
            as_type = FileType.VIAME_CSV
        elif file['exts'][-1] == 'json':
            data_dict = json.loads(file_string)
            if type(data_dict) is list:
                raise RestException('No array-type json objects are supported')
            if kwcoco.is_coco_json(data_dict):
                as_type = FileType.COCO_JSON
            try:
                data_dict = models.MetadataMutable(**data_dict).dict(exclude_none=True)
                as_type = FileType.DIVE_CONF
            except pydantic.ValidationError:
                as_type = FileType.DIVE_JSON
        else:
            raise RestException('Got file of unknown and unusable type')

    # Parse the file as the now known type
    if as_type == FileType.VIAME_CSV:
        tracks, attributes = viame.load_csv_as_tracks_and_attributes(file_string.splitlines())
        return as_type, tracks, attributes
    if as_type == FileType.COCO_JSON:
        tracks, attributes = kwcoco.load_coco_as_tracks_and_attributes(data_dict)
        return as_type, tracks, attributes
    if as_type == FileType.DIVE_CONF or as_type == FileType.DIVE_JSON:
        return as_type, data_dict, {}
    return None, {}, {}


def getTrackData(file: Optional[GirderModel]) -> Dict[str, dict]:
    """Wrapper function to get track data if type is already known"""
    return get_data_by_type(file, as_type=FileType.DIVE_JSON)[1]


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
