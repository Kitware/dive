import copy
import json
from pathlib import Path
from typing import Any, Dict, Generator, Iterable, List, Optional, Tuple

from bson.objectid import InvalidId, ObjectId
import cherrypy
from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.folder import Folder
from girder.models.item import Item
from girder.utility import ziputil
from pydantic.main import BaseModel

from dive_server import crud, crud_annotation
from dive_utils import TRUTHY_META_VALUES, asbool, constants, fromMeta, models, types
from dive_utils.serializers import kwcoco


def get_url(dataset: types.GirderModel, item: types.GirderModel) -> str:
    return f"/api/v1/dive_dataset/{str(dataset['_id'])}/media/{str(item['_id'])}/download"


def get_large_image_metadata_url(file: types.GirderModel, modelType='item') -> str:
    return f"api/v1/{modelType}/{str(file['_id'])}/tiles/internal_metadata"


def _clone_calibration_item(
    owner: types.GirderUserModel,
    source_parent: types.GirderModel,
    cloned_parent: types.GirderModel,
    calibration_item_id: str,
) -> Optional[str]:
    """Copy a stereoscopic calibration item onto a cloned multicam parent folder."""
    cal_item = Item().load(calibration_item_id, level=AccessType.READ, user=owner)
    if cal_item is None:
        return None
    if str(cal_item.get('folderId')) != str(source_parent['_id']):
        return None
    copied = Item().copyItem(cal_item, creator=owner, folder=cloned_parent)
    Item().setMetadata(copied, {constants.CalibrationFileMarker: 'true'})
    return str(copied['_id'])


def _create_multicam_soft_clone(
    owner: types.GirderUserModel,
    source_folder: types.GirderModel,
    parent_folder: types.GirderModel,
    name: str,
    revision: Optional[int],
):
    """Clone a multicam parent and each child camera folder; rewrite multiCam folder ids."""
    if len(name) == 0:
        raise RestException('Must supply non-empty name for clone')

    cloned_folder = Folder().createFolder(
        parent_folder,
        name,
        description=f'Clone of {source_folder["name"]}.',
        reuseExisting=False,
        creator=owner,
    )
    cloned_folder['meta'] = copy.deepcopy(source_folder['meta'])
    cloned_folder['meta'][constants.PublishedMarker] = False
    if constants.ConfidenceFiltersMarker not in cloned_folder['meta']:
        cloned_folder['meta'][constants.ConfidenceFiltersMarker] = {'default': 0.1}
    Folder().save(cloned_folder)
    crud.get_or_create_auxiliary_folder(cloned_folder, owner)

    multi_cam = fromMeta(source_folder, constants.MultiCamMarker) or {}
    new_cameras: Dict[str, Dict[str, str]] = {}
    for cam_name in _multicam_camera_order(multi_cam):
        cam_info = multi_cam['cameras'][cam_name]
        child = Folder().load(cam_info['folderId'], level=AccessType.READ, user=owner)
        if child is None:
            raise RestException(
                f'Camera folder for "{cam_name}" was not found',
                code=404,
            )
        cloned_child = _create_single_camera_soft_clone(
            owner, child, cloned_folder, cam_name, revision
        )
        new_cameras[cam_name] = {
            'folderId': str(cloned_child['_id']),
            'type': cam_info.get('type') or fromMeta(child, constants.TypeMarker),
        }

    updated_multi_cam = copy.deepcopy(multi_cam)
    updated_multi_cam['cameras'] = new_cameras
    calibration_item_id = updated_multi_cam.get(
        constants.CalibrationItemIdMarker
    ) or find_calibration_item_id(str(source_folder['_id']))
    if calibration_item_id:
        new_cal_id = _clone_calibration_item(
            owner, source_folder, cloned_folder, calibration_item_id
        )
        if new_cal_id:
            updated_multi_cam[constants.CalibrationItemIdMarker] = new_cal_id
    cloned_folder['meta'][constants.MultiCamMarker] = updated_multi_cam
    Folder().save(cloned_folder)
    crud_annotation.clone_annotations(source_folder, cloned_folder, owner, revision)
    return cloned_folder


def _create_single_camera_soft_clone(
    owner: types.GirderUserModel,
    source_folder: types.GirderModel,
    parent_folder: types.GirderModel,
    name: str,
    revision: Optional[int],
):
    """Create a no-copy clone of a single-camera folder."""
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


def createSoftClone(
    owner: types.GirderUserModel,
    source_folder: types.GirderModel,
    parent_folder: types.GirderModel,
    name: str,
    revision: Optional[int],
):
    """Create a no-copy clone of folder with source_id for owner"""
    if fromMeta(source_folder, constants.TypeMarker) == constants.MultiType:
        return _create_multicam_soft_clone(owner, source_folder, parent_folder, name, revision)

    return _create_single_camera_soft_clone(owner, source_folder, parent_folder, name, revision)


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


def _multicam_camera_order(multi_cam: dict) -> List[str]:
    """Return camera names in display order (stored order, else dict insertion order)."""
    cameras_meta = multi_cam.get('cameras') or {}
    stored_order = multi_cam.get('cameraOrder') or []
    if stored_order:
        return [name for name in stored_order if name in cameras_meta]
    return list(cameras_meta.keys())


def get_multi_cam_media(
    dsFolder: types.GirderModel, user: types.GirderUserModel
) -> models.MultiCamMedia:
    """Build MultiCamMedia by loading media for each child camera folder."""
    multi_cam = fromMeta(dsFolder, constants.MultiCamMarker)
    if not multi_cam:
        raise ValueError('Multi camera dataset missing multiCam metadata')
    default_display = multi_cam.get('defaultDisplay')
    if not default_display:
        raise ValueError('Multi camera dataset missing defaultDisplay')
    cameras_meta = multi_cam.get('cameras') or {}
    camera_order = _multicam_camera_order(multi_cam)
    cameras: Dict[str, models.MultiCamMediaCamera] = {}
    for name in camera_order:
        cam_info = cameras_meta[name]
        folder_id = cam_info.get('folderId')
        if not folder_id:
            raise ValueError(f'Camera "{name}" missing folderId')
        child = Folder().load(folder_id, level=AccessType.READ, user=user)
        if child is None:
            raise RestException(
                f'Camera folder {folder_id} for "{name}" was not found',
                code=404,
            )
        child_media = get_media(child, user)
        cam_type = cam_info.get('type') or fromMeta(child, constants.TypeMarker)
        video_url = child_media.video.url if child_media.video else ''
        cameras[name] = models.MultiCamMediaCamera(
            type=cam_type,
            imageData=child_media.imageData,
            videoUrl=video_url,
        )
    return models.MultiCamMedia(
        defaultDisplay=default_display,
        cameras=cameras,
        cameraOrder=camera_order,
    )


def get_dataset(
    dsFolder: types.GirderModel, user: types.GirderUserModel
) -> models.GirderMetadataStatic:
    """Transform a girder folder into a dataset metadata object"""
    crud.verify_dataset(dsFolder)
    meta = dict(dsFolder.get('meta', {}))
    source_type = fromMeta(dsFolder, constants.TypeMarker)
    multi_cam_media = None
    if source_type == constants.MultiType:
        multi_cam_media = get_multi_cam_media(dsFolder, user)
    sub_type = meta.pop(constants.SubTypeMarker, None)
    meta.pop(constants.MultiCamMarker, None)
    return models.GirderMetadataStatic(
        id=str(dsFolder['_id']),
        createdAt=str(dsFolder['created']),
        name=dsFolder['name'],
        foreign_media_id=dsFolder.get(constants.ForeignMediaIdMarker, None),
        subType=sub_type,
        multiCamMedia=multi_cam_media,
        **meta,
    )


def get_media(
    dsFolder: types.GirderModel, user: types.GirderUserModel
) -> models.DatasetSourceMedia:
    videoResource = None
    sourceVideoResource = None
    imageData: List[models.MediaResource] = []
    crud.verify_dataset(dsFolder)
    source_type = fromMeta(dsFolder, constants.TypeMarker)
    if source_type == constants.MultiType:
        return models.DatasetSourceMedia(
            imageData=imageData, video=videoResource, sourceVideo=sourceVideoResource
        )
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
            sourceVideoItem = Item().findOne(
                {
                    'folderId': crud.getCloneRoot(user, dsFolder)['_id'],
                    'meta.source_video': {'$in': [True, 'true', 'True']},
                }
            )
            if (
                sourceVideoItem
                and str(sourceVideoItem['_id']) != str(videoItem['_id'])
                and videoItem.get('meta', {}).get(constants.MISALGINED_MARKER, False) is False
            ):
                sourceVideoResource = models.MediaResource(
                    id=str(sourceVideoItem['_id']),
                    url=get_url(dsFolder, sourceVideoItem),
                    filename=sourceVideoItem['name'],
                )
            else:
                sourceVideoResource = videoResource
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
        imageData=imageData, video=videoResource, sourceVideo=sourceVideoResource
    )


class MetadataMutableUpdateArgs(models.MetadataMutable):
    """Update schema for mutable metadata fields"""

    class Config:
        extra = 'forbid'


def update_metadata(dsFolder: types.GirderModel, data: dict, verify=True):
    """Update mutable metadata"""
    if verify:
        crud.verify_dataset(dsFolder)
    validated: MetadataMutableUpdateArgs = crud.get_validated_model(
        MetadataMutableUpdateArgs, **data
    )
    for name, value in validated.dict(exclude_none=True).items():
        dsFolder['meta'][name] = value
    # exclude_none drops explicit null; client sends timeFilters: null to disable.
    if 'timeFilters' in data and data['timeFilters'] is None:
        dsFolder['meta'].pop('timeFilters', None)
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


class AttributeTrackFiltersUpdateArgs(BaseModel):
    upsert: List[models.AttributeTrackFilter] = []
    delete: List[str] = []

    class Config:
        extra = 'forbid'


def update_attribute_track_filters(dsFolder: types.GirderModel, data: dict):
    """Upsert or delete attributes"""
    crud.verify_dataset(dsFolder)
    validated: AttributeTrackFiltersUpdateArgs = crud.get_validated_model(
        AttributeTrackFiltersUpdateArgs, **data
    )
    attributesfilters_dict = fromMeta(dsFolder, 'attributeTrackFilters', {})

    for filter_id in validated.delete:
        attributesfilters_dict.pop(str(filter_id), None)
    for filter in validated.upsert:
        attributesfilters_dict[str(filter.name)] = filter.dict(exclude_none=True)

    upserted_len = len(validated.delete)
    deleted_len = len(validated.upsert)

    if upserted_len or deleted_len:
        update_metadata(dsFolder, {'attributeTrackFilters': attributesfilters_dict})


def _filtered_annotation_tracks(
    dsFolder: types.GirderModel,
    revision: Optional[int],
    excludeBelowThreshold: bool,
    typeFilter: Iterable[str],
) -> dict:
    """Return track dict for export after threshold and type filtering."""
    annotations = crud_annotation.get_annotations(dsFolder, revision=revision)
    tracks = annotations['tracks']
    thresholds = fromMeta(dsFolder, "confidenceFilters", {}) if excludeBelowThreshold else {}
    updated_tracks = {}
    for track_id in tracks:
        track = models.Track(**tracks[track_id])
        if excludeBelowThreshold and not track.exceeds_thresholds(thresholds):
            continue
        if typeFilter:
            confidence_pairs = [item for item in track.confidencePairs if item[0] in typeFilter]
            if not confidence_pairs:
                continue
        updated_tracks[track_id] = tracks[track_id]
    return updated_tracks


def _dive_json_export_text(
    dsFolder: types.GirderModel,
    revision: Optional[int],
    excludeBelowThreshold: bool,
    typeFilter: Iterable[str],
) -> str:
    annotations = crud_annotation.get_annotations(dsFolder, revision=revision)
    annotations['tracks'] = _filtered_annotation_tracks(
        dsFolder, revision, excludeBelowThreshold, typeFilter
    )
    return json.dumps(annotations)


def _coco_json_export_text(
    dsFolder: types.GirderModel,
    user: types.GirderUserModel,
    revision: Optional[int],
    excludeBelowThreshold: bool,
    typeFilter: Iterable[str],
) -> str:
    filtered_tracks = list(
        _filtered_annotation_tracks(dsFolder, revision, excludeBelowThreshold, typeFilter).values()
    )
    image_filenames = {}
    dataset_type = fromMeta(dsFolder, constants.TypeMarker)
    if dataset_type == constants.ImageSequenceType:
        images = crud.valid_images(dsFolder, user)
        image_filenames = {i: image['name'] for i, image in enumerate(images)}
    else:
        max_frame = -1
        for track_data in filtered_tracks:
            for feature in track_data.get('features', []):
                max_frame = max(max_frame, feature.get('frame', -1))
        image_filenames = {i: f'frame_{i:06d}.jpg' for i in range(max_frame + 1)}
    coco = kwcoco.export_dive_as_coco(
        filtered_tracks,
        image_filenames=image_filenames,
        dataset_name=dsFolder['name'],
    )
    return json.dumps(coco)


def export_multicam_annotations_zipstream(
    dsFolder: types.GirderModel,
    user: types.GirderUserModel,
    format: str,
    excludeBelowThreshold: bool,
    typeFilter: Optional[List[str]],
    revision: Optional[int] = None,
):
    """Zip per-camera annotation exports for a multicam parent dataset."""
    if format not in ('viame_csv', 'dive_json', 'coco_json'):
        raise RestException(f'Format {format} is not a valid option.')

    def stream():
        z = ziputil.ZipGenerator()
        zip_path = f"./{dsFolder['name']}/"
        multi_cam = fromMeta(dsFolder, constants.MultiCamMarker) or {}

        def makeMultiCamJson():
            yield json.dumps(multi_cam, indent=2).encode('utf-8')

        for data in z.addFile(makeMultiCamJson, Path(f'{zip_path}multiCam.json')):
            yield data

        nested_type_filter = typeFilter if typeFilter is not None else set()
        for cam_name in _multicam_camera_order(multi_cam):
            cam_info = multi_cam['cameras'][cam_name]
            child = Folder().load(cam_info['folderId'], level=AccessType.READ, user=user)
            if child is None:
                raise RestException(
                    f'Camera folder for "{cam_name}" was not found',
                    code=404,
                )
            child_path = f'{zip_path}{cam_name}/'
            if format == 'viame_csv':
                _, gen = crud_annotation.get_annotation_csv_generator(
                    child,
                    user,
                    excludeBelowThreshold,
                    nested_type_filter,
                    revision=revision,
                )
                for data in z.addFile(gen, Path(f'{child_path}annotations.viame.csv')):
                    yield data
            elif format == 'dive_json':

                def makeDiveJson(child_folder=child):
                    yield _dive_json_export_text(
                        child_folder,
                        revision,
                        excludeBelowThreshold,
                        nested_type_filter,
                    )

                for data in z.addFile(makeDiveJson, Path(f'{child_path}annotations.dive.json')):
                    yield data
            else:

                def makeCocoJson(child_folder=child):
                    yield _coco_json_export_text(
                        child_folder,
                        user,
                        revision,
                        excludeBelowThreshold,
                        nested_type_filter,
                    )

                for data in z.addFile(makeCocoJson, Path(f'{child_path}{child["name"]}.coco.json')):
                    yield data
        yield z.footer()

    return stream


def _yield_calibration_files(
    z: ziputil.ZipGenerator,
    zip_path: str,
    folder_id: str,
) -> Generator[bytes, None, None]:
    """Add stereoscopic calibration files from a multicam parent folder root."""
    for cal_item in _calibration_items_in_folder_root(folder_id):
        for path, file in Item().fileList(cal_item):
            for data in z.addFile(file, Path(f'{zip_path}{path}')):
                yield data
            break


def _yield_single_dataset_export(
    z: ziputil.ZipGenerator,
    zip_path: str,
    dsFolder: types.GirderModel,
    user: types.GirderUserModel,
    includeMedia: bool,
    includeDetections: bool,
    excludeBelowThreshold: bool,
    typeFilter: Iterable[str],
) -> Generator[bytes, None, None]:
    """Stream meta, annotations, media, and detections for one DIVE dataset folder."""

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
        elif source_type == constants.LargeImageType:
            mediaRegex = constants.largeImageRegEx
        return gen, mediaFolder, mediaRegex

    def makeMetajson():
        """Include dataset metadata file with full export"""
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
        tracks = annotations['tracks']
        thresholds = None
        if excludeBelowThreshold:
            thresholds = fromMeta(dsFolder, "confidenceFilters", {})
        if thresholds is None:
            thresholds = {}

        updated_tracks = {}
        for t in tracks:
            track = models.Track(**tracks[t])
            if (not excludeBelowThreshold) or track.exceeds_thresholds(thresholds):
                if typeFilter:
                    confidence_pairs = [
                        item for item in track.confidencePairs if item[0] in typeFilter
                    ]
                    if not confidence_pairs:
                        continue
                updated_tracks[t] = tracks[t]
        annotations['tracks'] = updated_tracks
        yield json.dumps(annotations)

    for data in z.addFile(makeMetajson, Path(f'{zip_path}meta.json')):
        yield data

    for data in z.addFile(makeDiveJson, Path(f'{zip_path}annotations.dive.json')):
        yield data

    gen, mediaFolder, mediaRegex = makeAnnotationAndMedia(dsFolder)
    if includeMedia and mediaRegex is not None:
        for item in Folder().childItems(
            mediaFolder,
            filters={"lowerName": {"$regex": mediaRegex}},
        ):
            for path, file in Item().fileList(item):
                for data in z.addFile(file, Path(f'{zip_path}{path}')):
                    yield data
                break

    if includeDetections:
        for data in z.addFile(gen, Path(f'{zip_path}annotations.viame.csv')):
            yield data


def _yield_multicam_dataset_export(
    z: ziputil.ZipGenerator,
    zip_path: str,
    dsFolder: types.GirderModel,
    user: types.GirderUserModel,
    includeMedia: bool,
    includeDetections: bool,
    excludeBelowThreshold: bool,
    typeFilter: Iterable[str],
) -> Generator[bytes, None, None]:
    """Export a multicam parent plus each child camera folder."""
    multi_cam = fromMeta(dsFolder, constants.MultiCamMarker) or {}

    def makeMultiCamJson():
        yield json.dumps(multi_cam, indent=2).encode('utf-8')

    for data in z.addFile(makeMultiCamJson, Path(f'{zip_path}multiCam.json')):
        yield data

    for data in _yield_single_dataset_export(
        z,
        zip_path,
        dsFolder,
        user,
        False,
        includeDetections,
        excludeBelowThreshold,
        typeFilter,
    ):
        yield data

    if includeMedia:
        for data in _yield_calibration_files(z, zip_path, str(dsFolder['_id'])):
            yield data

    for cam_name in _multicam_camera_order(multi_cam):
        cam_info = multi_cam['cameras'][cam_name]
        child = Folder().load(cam_info['folderId'], level=AccessType.READ, user=user)
        if child is None:
            raise RestException(
                f'Camera folder for "{cam_name}" was not found',
                code=404,
            )
        child_path = f'{zip_path}{cam_name}/'
        for data in _yield_single_dataset_export(
            z,
            child_path,
            child,
            user,
            includeMedia,
            includeDetections,
            excludeBelowThreshold,
            typeFilter,
        ):
            yield data


def export_datasets_zipstream(
    dsFolders: List[types.GirderModel],
    user: types.GirderUserModel,
    includeMedia: bool,
    includeDetections: bool,
    excludeBelowThreshold: bool,
    typeFilter: Optional[List[str]],
):
    failed_datasets = []

    def stream():
        z = ziputil.ZipGenerator()
        nestedTypeFilter = typeFilter
        if nestedTypeFilter is None:
            nestedTypeFilter = set()
        for dsFolder in dsFolders:
            zip_path = f"./{dsFolder['name']}/"
            source_type = fromMeta(dsFolder, constants.TypeMarker)
            try:
                if source_type == constants.MultiType:
                    get_multi_cam_media(dsFolder, user)
                else:
                    get_media(dsFolder, user)
            except (RestException, ValueError):
                failed_datasets.append(
                    f"Dataset: {dsFolder['name']} was not found. \
                        This may be a cloned dataset where the source was deleted.\n"
                )
                continue

            try:
                if source_type == constants.MultiType:
                    for data in _yield_multicam_dataset_export(
                        z,
                        zip_path,
                        dsFolder,
                        user,
                        includeMedia,
                        includeDetections,
                        excludeBelowThreshold,
                        nestedTypeFilter,
                    ):
                        yield data
                else:
                    for data in _yield_single_dataset_export(
                        z,
                        zip_path,
                        dsFolder,
                        user,
                        includeMedia,
                        includeDetections,
                        excludeBelowThreshold,
                        nestedTypeFilter,
                    ):
                        yield data
            except RestException:
                failed_datasets.append(
                    f"Dataset: {dsFolder['name']} was not found. \
                        This may be a cloned dataset where the source was deleted.\n"
                )
                continue
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


class CreateMulticamArgs(BaseModel):
    name: str
    fps: float
    type: str
    subType: str
    defaultDisplay: str
    cameras: Dict[str, Dict[str, str]]
    cameraOrder: Optional[List[str]] = None
    calibrationFileId: Optional[str] = None

    class Config:
        extra = 'forbid'


def _child_media_frame_count(
    child: types.GirderModel, user: types.GirderUserModel, media_type: str
) -> int:
    if media_type == constants.ImageSequenceType:
        return len(crud.valid_images(child, user))
    if media_type == constants.VideoType:
        video_item = Item().findOne(
            {
                'folderId': child['_id'],
                'meta.codec': 'h264',
                'meta.source_video': {'$in': [None, False]},
            }
        )
        if video_item is None:
            raise RestException(
                f'Camera folder "{child["name"]}" does not contain a processed video',
                code=400,
            )
        return 1
    raise RestException(f'Unsupported camera media type: {media_type}', code=400)


def _mongo_id(value: str):
    """Coerce a Girder id string to ObjectId for MongoDB queries."""
    try:
        return ObjectId(value)
    except InvalidId:
        return value


def _item_has_calibration_marker(cal_item: dict) -> bool:
    """True when the Girder item is marked as a stereoscopic calibration file."""
    return asbool(cal_item.get('meta', {}).get(constants.CalibrationFileMarker))


def _calibration_items_in_folder_root(folder_id: str):
    """
    Yield calibration file items stored in the dataset folder root.

    Camera media lives in child folders; only direct items on folder_id are considered.
    Scans all folder items and matches meta.calibrationFile in Python so boolean/string
    metadata values both work.
    """
    for cal_item in Item().find({'folderId': _mongo_id(folder_id)}, sort=[('created', -1)]):
        if _item_has_calibration_marker(cal_item) and constants.stereoCalibrationRegex.search(
            cal_item['name']
        ):
            yield cal_item


def find_calibration_item_id(folder_id: str) -> Optional[str]:
    """Return the most recent marked calibration file item in the dataset folder root."""
    for cal_item in _calibration_items_in_folder_root(folder_id):
        return str(cal_item['_id'])
    return None


def resolve_stereo_calibration_item_id(
    parent_folder: types.GirderModel,
    pipeline: types.PipelineDescription,
) -> Optional[str]:
    """
    Resolve stereoscopic calibration item id for pipeline input.

    Returns an item in the dataset folder root with meta.calibrationFile set. Only
    measurement pipelines on stereo datasets use calibration input.
    """
    if fromMeta(parent_folder, constants.SubTypeMarker) != 'stereo':
        return None
    if pipeline.get('type') != constants.StereoPipelineMarker:
        return None

    folder_id = str(parent_folder['_id'])
    item_id = find_calibration_item_id(folder_id)
    if item_id is not None:
        return item_id

    # Legacy imports may have calibrationItemId on multiCam without item meta set.
    multi_cam = fromMeta(parent_folder, constants.MultiCamMarker, default={})
    if not isinstance(multi_cam, dict):
        multi_cam = {}
    cached_id = multi_cam.get(constants.CalibrationItemIdMarker)
    if not cached_id:
        return None
    cal_item = Item().findOne({'_id': _mongo_id(cached_id)})
    if cal_item is None:
        return None
    if str(cal_item.get('folderId')) != folder_id:
        return None
    if not constants.stereoCalibrationRegex.search(cal_item['name']):
        return None
    if not _item_has_calibration_marker(cal_item):
        Item().setMetadata(cal_item, {constants.CalibrationFileMarker: 'true'})
    return str(cal_item['_id'])


def create_multicam(
    user: types.GirderUserModel,
    parent_folder: types.GirderModel,
    data: dict,
) -> types.GirderModel:
    """Finalize a multicam dataset whose camera folders already live under parent_folder."""
    validated: CreateMulticamArgs = crud.get_validated_model(CreateMulticamArgs, **data)
    if parent_folder['name'] != validated.name:
        raise RestException(
            f'Dataset folder name "{parent_folder["name"]}" does not match "{validated.name}"',
            code=400,
        )
    cameras = validated.cameras
    if not cameras:
        raise RestException('At least one camera is required', code=400)

    camera_names = list(cameras.keys())
    if validated.subType == 'stereo':
        if len(camera_names) != 2:
            raise RestException('Stereo datasets require exactly 2 cameras', code=400)
    elif validated.subType == 'multicam':
        if len(camera_names) < 2 or len(camera_names) > 3:
            raise RestException('Multicam datasets require 2 or 3 cameras', code=400)
    else:
        raise RestException(f'Invalid subType: {validated.subType}', code=400)

    if validated.defaultDisplay not in cameras:
        raise RestException(
            f'defaultDisplay "{validated.defaultDisplay}" is not a camera name',
            code=400,
        )

    if validated.type not in (constants.ImageSequenceType, constants.VideoType):
        raise RestException(
            f'Multicam type must be image-sequence or video, not {validated.type}',
            code=400,
        )

    if validated.cameraOrder is not None:
        camera_order = validated.cameraOrder
        if set(camera_order) != set(cameras.keys()):
            raise RestException(
                'cameraOrder must list each camera name exactly once',
                code=400,
            )
    else:
        camera_order = list(cameras.keys())

    loaded_children: Dict[str, types.GirderModel] = {}
    frame_counts: List[int] = []
    child_fps_by_name: Dict[str, float] = {}
    for name in camera_order:
        cam = cameras[name]
        folder_id = cam.get('folderId')
        if not folder_id:
            raise RestException(f'Camera "{name}" missing folderId', code=400)
        child = Folder().load(folder_id, level=AccessType.WRITE, user=user)
        if child is None:
            raise RestException(f'Camera folder {folder_id} was not found', code=404)
        if str(child.get('parentId')) != str(parent_folder['_id']):
            raise RestException(
                f'Camera folder "{name}" must be a direct child of the dataset folder',
                code=400,
            )
        crud.verify_dataset(child)
        child_type = fromMeta(child, constants.TypeMarker)
        if child_type != validated.type:
            raise RestException(
                f'Camera "{name}" has type {child_type}, expected {validated.type}',
                code=400,
            )
        child_fps = fromMeta(child, constants.FPSMarker)
        child_fps_by_name[name] = child_fps
        frame_counts.append(_child_media_frame_count(child, user, validated.type))
        loaded_children[name] = child

    use_video_fps = validated.type == constants.VideoType and validated.fps == -1
    if use_video_fps:
        unique_fps = set(child_fps_by_name.values())
        if len(unique_fps) > 1:
            raise RestException(
                'All cameras must have the same fps when using video-derived frame rate',
                code=400,
            )
    else:
        for name, child_fps in child_fps_by_name.items():
            if child_fps != validated.fps:
                raise RestException(
                    f'Camera "{name}" has fps {child_fps}, expected {validated.fps}',
                    code=400,
                )

    if len(set(frame_counts)) > 1:
        expected = frame_counts[0]
        raise RestException(
            f'All cameras must have the same number of frames (expected {expected})',
            code=400,
        )

    default_child = loaded_children[validated.defaultDisplay]
    parent_folder_doc = parent_folder
    multi_cam_cameras: Dict[str, Dict[str, str]] = {}
    for name in camera_order:
        child = loaded_children[name]
        if child['name'] != name:
            child['name'] = name
            Folder().save(child)
        multi_cam_cameras[name] = {
            'folderId': str(child['_id']),
            'type': validated.type,
        }

    calibration_item_id = None
    if validated.calibrationFileId:
        if validated.subType != 'stereo':
            raise RestException('Calibration is only supported for stereo datasets', code=400)
        cal_item = Item().load(validated.calibrationFileId, level=AccessType.WRITE, user=user)
        if cal_item is None:
            raise RestException('Calibration file was not found', code=404)
        if str(cal_item.get('folderId')) != str(parent_folder_doc['_id']):
            raise RestException(
                'Calibration file must be stored in the dataset folder',
                code=400,
            )
        if not constants.stereoCalibrationRegex.search(cal_item['name']):
            raise RestException(
                'Calibration file must be .npz, .json, .cam, .yml, or .zip',
                code=400,
            )
        Item().setMetadata(cal_item, {constants.CalibrationFileMarker: 'true'})
        calibration_item_id = str(cal_item['_id'])

    parent_folder_doc['meta'] = {
        constants.DatasetMarker: True,
        constants.TypeMarker: constants.MultiType,
        constants.SubTypeMarker: validated.subType,
        constants.FPSMarker: fromMeta(default_child, constants.FPSMarker),
        constants.MultiCamMarker: {
            'defaultDisplay': validated.defaultDisplay,
            'cameraOrder': camera_order,
            'cameras': multi_cam_cameras,
            **(
                {constants.CalibrationItemIdMarker: calibration_item_id}
                if calibration_item_id
                else {}
            ),
        },
        constants.ConfidenceFiltersMarker: {'default': 0.1},
    }
    Folder().save(parent_folder_doc)
    crud.get_or_create_auxiliary_folder(parent_folder_doc, user)
    return parent_folder_doc


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
    elif len(images):
        mediatype = constants.ImageSequenceType
    elif len(large_images):
        mediatype = constants.LargeImageType

    return {
        "ok": ok,
        "message": message,
        "type": mediatype,
        "media": images + videos + large_images,
        "annotations": csvs + ymls + jsons,
    }
