from typing import List, Optional

from girder.models.folder import Folder
from girder.models.item import Item
from girder.utility import ziputil
from pydantic.main import BaseModel

from dive_server import crud
from dive_utils import TRUTHY_META_VALUES, constants, fromMeta, models, types


def get_url(file: types.GirderModel, modelType='file') -> str:
    return f"api/v1/{modelType}/{str(file['_id'])}/download"


def createSoftClone(
    owner: types.GirderModel,
    source_folder: types.GirderModel,
    parent_folder: types.GirderModel,
    name: str = None,
):
    """Create a no-copy clone of folder with source_id for owner"""
    cloned_folder = Folder().createFolder(
        parent_folder,
        name or source_folder['name'],
        description=f'Clone of {source_folder["name"]}.',
        reuseExisting=False,
    )
    cloned_folder['meta'] = source_folder['meta']
    media_source_folder = crud.getCloneRoot(owner, source_folder)
    cloned_folder['meta'][constants.ForeignMediaIdMarker] = str(media_source_folder['_id'])
    cloned_folder['meta'][constants.PublishedMarker] = False
    # ensure confidence filter metadata exists
    if constants.ConfidenceFiltersMarker not in cloned_folder['meta']:
        cloned_folder['meta'][constants.ConfidenceFiltersMarker] = {'default': 0.1}

    Folder().save(cloned_folder)
    crud.get_or_create_auxiliary_folder(cloned_folder, owner)
    source_detections = crud.detections_item(source_folder)
    if source_detections is not None:
        cloned_detection_item = Item().copyItem(
            source_detections, creator=owner, folder=cloned_folder
        )
        cloned_detection_item['meta'][constants.DetectionMarker] = str(cloned_folder['_id'])
        Item().save(cloned_detection_item)
    else:
        crud.saveTracks(cloned_folder, {}, owner)
    return cloned_folder


def list_datasets(user: types.GirderModel, published: bool, limit: int, offset: int, sort: str):
    """Enumerate all public and private data the user can access"""
    query: dict = {
        f'meta.{constants.DatasetMarker}': {'$in': TRUTHY_META_VALUES},
    }
    if published:
        query = {
            '$and': [
                query,
                {f'meta.{constants.PublishedMarker}': {'$in': TRUTHY_META_VALUES}},
            ]
        }
    return Folder().findWithPermissions(query, offset=offset, limit=limit, sort=sort, user=user)


def get_dataset(
    dsFolder: types.GirderModel, user: types.GirderModel
) -> models.GirderMetadataStatic:
    """Transform a girder folder into a dataset metadata object"""
    videoUrl = None
    imageData: List[models.FrameImage] = []
    crud.verify_dataset(dsFolder)
    source_type = fromMeta(dsFolder, constants.TypeMarker)

    if source_type == constants.VideoType:
        # Find a video tagged with an h264 codec left by the transcoder
        videoItem = Item().findOne(
            {
                'folderId': crud.getCloneRoot(user, dsFolder)['_id'],
                'meta.codec': 'h264',
                'meta.source_video': {'$in': [None, False]},
            }
        )
        if videoItem:
            videoFile = Item().childFiles(videoItem)[0]
            videoUrl = get_url(videoFile)
    elif source_type == constants.ImageSequenceType:
        imageData = [
            models.FrameImage(
                url=get_url(image, modelType='item'),
                filename=image['name'],
            )
            for image in crud.valid_images(dsFolder, user)
        ]
    else:
        raise ValueError(f'Unrecognized source type: {source_type}')

    return models.GirderMetadataStatic(
        id=str(dsFolder['_id']),
        imageData=imageData,
        videoUrl=videoUrl,
        createdAt=str(dsFolder['created']),
        name=dsFolder['name'],
        **dsFolder['meta'],
    )


class MetadataMutableUpdateArgs(models.MetadataMutable):
    """Update schema for mutable metadata fields"""

    class Config:
        extra = 'forbid'


def update_metadata(dsFolder: types.GirderModel, data: dict):
    """Update mutable metadata"""
    crud.verify_dataset(dsFolder)
    validated: MetadataMutableUpdateArgs = crud.get_validated_model(
        MetadataMutableUpdateArgs, **data
    )
    for name, value in validated.dict(exclude_none=True).items():
        dsFolder['meta'][name] = value
    Folder().save(dsFolder)
    return dsFolder['meta']


class AttributeUpdateArgs(BaseModel):
    upsert: List[models.Attribute] = []
    delete: List[str] = []

    class Config:
        extra = 'forbid'


def update_attributes(dsFolder: types.GirderModel, data: dict):
    """Upsert or delete attributes"""
    crud.verify_dataset(dsFolder)
    validated: AttributeUpdateArgs = crud.get_validated_model(AttributeUpdateArgs, **data)
    attributes_dict = fromMeta(dsFolder, 'attributes', {})

    for attribute_id in validated.delete:
        attributes_dict.pop(str(attribute_id), None)
    for attribute in validated.upsert:
        attributes_dict[str(attribute.key)] = validated.dict(exclude_none=True)

    upserted_len = len(validated.delete)
    deleted_len = len(validated.upsert)

    if upserted_len or deleted_len:
        update_metadata(dsFolder, {'attributes': attributes_dict})

    return {
        "updated": upserted_len,
        "deleted": deleted_len,
    }


def export_dataset_zipstream(
    dsFolder: types.GirderModel,
    user: types.GirderModel,
    includeMedia: bool,
    includeDetections: bool,
    excludeBelowThreshold: bool,
    typeFilter: Optional[List[str]],
):
    _, gen = crud.get_annotation_csv_generator(dsFolder, user, excludeBelowThreshold, typeFilter)
    mediaFolder = crud.getCloneRoot(user, dsFolder)
    source_type = fromMeta(mediaFolder, constants.TypeMarker)
    mediaRegex = None
    if source_type == constants.ImageSequenceType:
        mediaRegex = constants.imageRegex
    elif source_type == constants.VideoType:
        mediaRegex = constants.videoRegex

    def makeMetajson():
        yield get_dataset(dsFolder, user).json(exclude_none=True)

    def stream():
        z = ziputil.ZipGenerator(dsFolder['name'])

        # Always add the metadata file
        z.addFile(makeMetajson, 'meta.json')

        if includeMedia:
            # Add media
            for item in Folder().childItems(
                mediaFolder,
                filters={"lowerName": {"$regex": mediaRegex}},
            ):
                for (path, file) in Item().fileList(item):
                    for data in z.addFile(file, path):
                        yield data
                    break  # Media items should only have 1 valid file

        if includeDetections:
            # add JSON detections
            for (path, file) in Folder().fileList(
                dsFolder,
                user=user,
                subpath=False,
                mimeFilter={'application/json'},
            ):
                for data in z.addFile(file, path):
                    yield data
            # add CSV detections
            for data in z.addFile(gen, "output_tracks.csv"):
                yield data
        yield z.footer()

    return stream


def validate_files(files: List[str]):
    """
    Given a collection of filenames, guess based on regular expressions
    if the collection represents a valid dataset, and if so, which files
    represent which type of data
    """
    ok = True
    message = ""
    mediatype = ""
    videos = [f for f in files if constants.videoRegex.search(f)]
    csvs = [f for f in files if constants.csvRegex.search(f)]
    images = [f for f in files if constants.imageRegex.search(f)]
    ymls = [f for f in files if constants.ymlRegex.search(f)]
    jsons = [f for f in files if constants.jsonRegex.search(f)]
    if len(videos) and len(images):
        ok = False
        message = "Do not upload images and videos in the same batch."
    elif len(csvs) > 1:
        ok = False
        message = "Can only upload a single CSV Annotation per import"
    elif len(jsons) > 1:
        ok = False
        message = "Can only upload a single JSON Annotation per import"
    elif len(csvs) == 1 and len(ymls):
        ok = False
        message = "Cannot mix annotation import types"
    elif len(videos) > 1 and (len(csvs) or len(ymls) or len(jsons)):
        ok = False
        message = "Annotation upload is not supported when multiple videos are uploaded"
    elif (not len(videos)) and (not len(images)):
        ok = False
        message = "No supported media-type files found"
    elif len(videos):
        mediatype = 'video'
    elif len(images):
        mediatype = 'image-sequence'

    return {
        "ok": ok,
        "message": message,
        "type": mediatype,
        "media": images + videos,
        "annotations": csvs + ymls + jsons,
    }
