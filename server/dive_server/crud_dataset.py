import cherrypy
import json
from typing import List, Optional, Tuple

from girder.constants import AccessType
from girder.exceptions import RestException
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
    name: str,
):
    """Create a no-copy clone of folder with source_id for owner"""
    if len(name) == 0:
        raise RestException('Must supply non-empty name for clone')

    cloned_folder = Folder().createFolder(
        parent_folder,
        name,
        description=f'Clone of {source_folder["name"]}.',
        reuseExisting=False,
        creator=owner,
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


def list_datasets(
    user: types.GirderUserModel,
    published: bool,
    shared: bool,
    limit: int,
    offset: int,
    sortParams: Tuple[str, int],
):
    """Enumerate all public and private data the user can access"""
    permissionsClause = Folder().permissionClauses(user=user, level=AccessType.READ)
    query = {
        '$and': [
            {f'meta.{constants.DatasetMarker}': {'$in': TRUTHY_META_VALUES}},
            permissionsClause,
        ],
    }
    sort, sortDir = (sortParams or [['created', 1]])[0]
    if published:
        query['$and'] += [{f'meta.{constants.PublishedMarker}': {'$in': TRUTHY_META_VALUES}}]
    if shared:
        query['$and'] += [
            {
                # Find datasets not owned by the current user
                '$nor': [
                    {'creatorId': {'$eq': user['_id']}},
                    {'creatorId': {'$eq': None}},
                ],
            },
            {
                # But where the current user still has access
                'access.users': {
                    '$elemMatch': {
                        'id': user['_id'],
                    }
                },
            },
        ]
    # based on https://stackoverflow.com/a/49483919
    pipeline = [
        {'$match': query},
        {
            '$facet': {
                'results': [
                    {'$sort': {sort: sortDir}},
                    {'$skip': offset},
                    {'$limit': limit},
                    {
                        '$lookup': {
                            'from': 'user',
                            'localField': 'creatorId',
                            'foreignField': '_id',
                            'as': 'ownerLogin',
                        },
                    },
                    {'$set': {'ownerLogin': {'$first': '$ownerLogin'}}},
                    {'$set': {'ownerLogin': '$ownerLogin.login'}},
                ],
                'totalCount': [{'$count': 'count'}],
            },
        },
    ]
    response = next(Folder().collection.aggregate(pipeline))
    total = response['totalCount'][0]['count'] if len(response['results']) > 0 else 0
    cherrypy.response.headers['Girder-Total-Count'] = total
    return [Folder().filter(doc, additionalKeys=['ownerLogin']) for doc in response['results']]


def get_dataset(
    dsFolder: types.GirderModel, user: types.GirderUserModel
) -> models.GirderMetadataStatic:
    """Transform a girder folder into a dataset metadata object"""
    crud.verify_dataset(dsFolder)
    return models.GirderMetadataStatic(
        id=str(dsFolder['_id']),
        createdAt=str(dsFolder['created']),
        name=dsFolder['name'],
        **dsFolder['meta'],
    )


def get_media(
    dsFolder: types.GirderModel, user: types.GirderUserModel
) -> models.DatasetSourceMedia:
    videoResource = None
    imageData: List[models.MediaResource] = []
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
            videoFile: types.GirderModel = Item().childFiles(videoItem)[0]
            videoResource = models.MediaResource(
                id=str(videoFile['_id']),
                url=get_url(videoFile),
                filename=videoFile['name'],
            )
    elif source_type == constants.ImageSequenceType:
        imageData = [
            models.MediaResource(
                id=str(image["_id"]),
                url=get_url(image, modelType='item'),
                filename=image['name'],
            )
            for image in crud.valid_images(dsFolder, user)
        ]
    else:
        raise ValueError(f'Unrecognized source type: {source_type}')

    return models.DatasetSourceMedia(
        imageData=imageData,
        video=videoResource,
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
    user: types.GirderUserModel,
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
        """Include dataset metadtata file with full export"""
        meta = get_dataset(dsFolder, user)
        media = get_media(dsFolder, user)
        yield json.dumps(
            {
                **meta.dict(exclude_none=True),
                **media.dict(exclude_none=True),
            },
            indent=2,
        )

    def stream():
        z = ziputil.ZipGenerator(dsFolder['name'])

        # Always add the metadata file
        for data in z.addFile(makeMetajson, 'meta.json'):
            yield data

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
