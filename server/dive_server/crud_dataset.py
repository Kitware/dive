import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cherrypy
from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.folder import Folder
from girder.models.item import Item
from girder.utility import ziputil
from pydantic.main import BaseModel

from dive_server import crud, crud_annotation
from dive_utils import TRUTHY_META_VALUES, constants, fromMeta, models, types


def get_url(dataset: types.GirderModel, item: types.GirderModel) -> str:
    return f"/api/v1/dive_dataset/{str(dataset['_id'])}/media/{str(item['_id'])}/download"

def get_large_image_metadata_url(file: types.GirderModel, modelType='item') -> str:
    return f"api/v1/{modelType}/{str(file['_id'])}/tiles/internal_metadata"



def createSoftClone(
    owner: types.GirderUserModel,
    source_folder: types.GirderModel,
    parent_folder: types.GirderModel,
    name: str,
    revision: Optional[int],
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
    cloned_folder[constants.ForeignMediaIdMarker] = str(media_source_folder['_id'])
    cloned_folder['meta'][constants.PublishedMarker] = False
    # ensure confidence filter metadata exists
    if constants.ConfidenceFiltersMarker not in cloned_folder['meta']:
        cloned_folder['meta'][constants.ConfidenceFiltersMarker] = {'default': 0.1}
    Folder().save(cloned_folder)
    crud.get_or_create_auxiliary_folder(cloned_folder, owner)
    crud_annotation.clone_annotations(source_folder, cloned_folder, owner, revision)
    return cloned_folder


def list_datasets(
    user: types.GirderUserModel,
    published: bool,
    shared: bool,
    limit: int,
    offset: int,
    sortParams: Tuple[Tuple[str, int]],
):
    """Enumerate all public and private data the user can access"""
    sort, sortDir = (sortParams or [['created', 1]])[0]
    # based on https://stackoverflow.com/a/49483919
    pipeline = [
        {'$match': get_dataset_query(user, published, shared)},
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
        foreign_media_id=dsFolder.get(constants.ForeignMediaIdMarker, None),
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
            videoResource = models.MediaResource(
                id=str(videoItem['_id']),
                url=get_url(dsFolder, videoItem),
                filename=videoItem['name'],
            )
    elif source_type == constants.ImageSequenceType:
        imageData = [
            models.MediaResource(
                id=str(image["_id"]),
                url=get_url(dsFolder, image),
                filename=image['name'],
            )
            for image in crud.valid_images(dsFolder, user)
        ]
    elif source_type == constants.LargeImageType:
        imageData = [
            models.MediaResource(
                id=str(image["_id"]),
                url=get_large_image_metadata_url(image, modelType='item'),
                filename=image['name'],
            )
            for image in crud.valid_large_images(dsFolder, user)
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
        attributes_dict[str(attribute.key)] = attribute.dict(exclude_none=True)

    upserted_len = len(validated.delete)
    deleted_len = len(validated.upsert)

    if upserted_len or deleted_len:
        update_metadata(dsFolder, {'attributes': attributes_dict})

    return {
        "updated": upserted_len,
        "deleted": deleted_len,
    }


def export_datasets_zipstream(
    dsFolders: List[types.GirderModel],
    user: types.GirderUserModel,
    includeMedia: bool,
    includeDetections: bool,
    excludeBelowThreshold: bool,
    typeFilter: Optional[List[str]],
):
    def makeAnnotationAndMedia(dsFolder: types.GirderModel):
        _, gen = crud_annotation.get_annotation_csv_generator(
            dsFolder, user, excludeBelowThreshold, typeFilter
        )
        mediaFolder = crud.getCloneRoot(user, dsFolder)

        source_type = fromMeta(mediaFolder, constants.TypeMarker)
        mediaRegex = None
        if source_type == constants.ImageSequenceType:
            mediaRegex = constants.imageRegex
        elif source_type == constants.VideoType:
            mediaRegex = constants.videoRegex
        return gen, mediaFolder, mediaRegex

    failed_datasets = []

    def stream():
        z = ziputil.ZipGenerator()
        for dsFolder in dsFolders:
            zip_path = f"./{dsFolder['name']}/"
            try:
                get_media(dsFolder, user)
            except RestException:
                failed_datasets.append(
                    f"Dataset: {dsFolder['name']} was not found. \
                        This may be a cloned dataset where the source was deleted.\n"
                )
                continue

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

            def makeDiveJson():
                """Include DIVE JSON output annotation file"""
                annotations = crud_annotation.get_annotations(dsFolder)
                print(annotations)
                yield json.dumps(annotations)

            for data in z.addFile(makeMetajson, Path(f'{zip_path}meta.json')):
                yield data

            for data in z.addFile(makeDiveJson, Path(f'{zip_path}annotations.dive.json')):
                yield data

            gen, mediaFolder, mediaRegex = makeAnnotationAndMedia(dsFolder)
            if includeMedia:
                # Add media
                for item in Folder().childItems(
                    mediaFolder,
                    filters={"lowerName": {"$regex": mediaRegex}},
                ):
                    for (path, file) in Item().fileList(item):
                        for data in z.addFile(file, Path(f'{zip_path}{path}')):
                            yield data
                        break  # Media items should only have 1 valid file

            if includeDetections:
                for data in z.addFile(gen, Path(f'{zip_path}annotations.viame.csv')):
                    yield data
        if len(failed_datasets) > 0:

            def makeFailedDatasets():
                yield ''.join(failed_datasets)

            for data in z.addFile(makeFailedDatasets, Path('./failed_datasets.txt')):
                yield data
        yield z.footer()

    return stream


def get_dataset_query(
    user: types.GirderUserModel,
    published: bool,
    shared: bool,
    level=AccessType.READ,
):
    base_query = {
        '$and': [
            {f'meta.{constants.DatasetMarker}': {'$in': TRUTHY_META_VALUES}},
            Folder().permissionClauses(user=user, level=level),
        ]
    }
    optional_query_parts: List[Dict[str, Any]] = []

    if published:
        optional_query_parts.append(
            {f'meta.{constants.PublishedMarker}': {'$in': TRUTHY_META_VALUES}}
        )
    if shared:
        optional_query_parts.append(
            {
                '$and': [
                    {
                        # Find datasets not owned by the current user
                        '$nor': [{'creatorId': {'$eq': user['_id']}}, {'creatorId': {'$eq': None}}]
                    },
                    {
                        # But where the current user has been given explicit access
                        # Implicit public datasets should not be considered "shared"
                        'access.users': {'$elemMatch': {'id': user['_id']}}
                    },
                ]
            }
        )

    if len(optional_query_parts):
        return {'$and': [base_query, {'$or': optional_query_parts}]}
    return base_query


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
    large_images = [f for f in files if constants.largeImageRegEx.search(f)]
    ymls = [f for f in files if constants.ymlRegex.search(f)]
    jsons = [f for f in files if constants.jsonRegex.search(f)]
    if len(videos) and (len(images) or len(large_images)):
        ok = False
        message = "Do not upload images and videos in the same batch."
    elif len(large_images) and len(images):
        ok = False
        message = "Do not upload images and tile images in the same batch."
    elif len(csvs) > 1:
        ok = False
        message = "Can only upload a single CSV Annotation per import"
    elif len(jsons) > 2:
        ok = False
        message = (
            "Can only upload a single JSON Annotation and single configuration JSON per import"
        )
    elif len(csvs) == 1 and len(ymls):
        ok = False
        message = "Cannot mix annotation import types"
    elif len(videos) > 1 and (len(csvs) or len(ymls) or len(jsons)):
        ok = False
        message = "Annotation upload is not supported when multiple videos are uploaded"
    elif (not len(videos)) and (not len(images)) and (not len(large_images)):
        ok = False
        message = "No supported media-type files found"
    elif len(videos):
        mediatype = constants.VideoType
        mediatype = constants.ImageSequenceType
    elif len(large_images):
        mediatype = constants.LargeImageType

    return {
        "ok": ok,
        "message": message,
        "type": mediatype,
        "media": images + videos,
        "annotations": csvs + ymls + jsons,
    }
