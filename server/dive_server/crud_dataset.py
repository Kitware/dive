import copy
import json
from pathlib import Path
from typing import Any, Dict, Generator, Iterable, List, Literal, Optional, Set, Tuple

from bson.objectid import InvalidId, ObjectId
import cherrypy
from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.token import Token
from girder.utility import ziputil
from pydantic.main import BaseModel

from dive_server import crud, crud_annotation
from dive_tasks import tasks
from dive_utils import (
    TRUTHY_META_VALUES,
    asbool,
    calibration_format,
    constants,
    frame_metadata,
    fromMeta,
    models,
    multicam_camera_order,
    types,
)
from dive_utils.serializers import kwcoco
from dive_utils.type_hierarchy import (
    HierarchyWrite,
    TypeHierarchyError,
    normalize_type_hierarchy,
    resolve_type_hierarchy,
)


def get_url(dataset: types.GirderModel, item: types.GirderModel) -> str:
    return f"/api/v1/dive_dataset/{str(dataset['_id'])}/media/{str(item['_id'])}/download"


def get_large_image_metadata_url(file: types.GirderModel, modelType='item') -> str:
    return f"api/v1/{modelType}/{str(file['_id'])}/tiles/internal_metadata"


def _clone_calibration_item(
    owner: types.GirderUserModel,
    source_parent: types.GirderModel,
    cloned_parent: types.GirderModel,
    calibration_item_id: str,
    marker: str,
) -> Optional[str]:
    """Copy a stereoscopic calibration item onto a cloned multicam parent folder."""
    cal_item = Item().load(calibration_item_id, level=AccessType.READ, user=owner)
    if cal_item is None:
        return None
    if str(cal_item.get('folderId')) != str(source_parent['_id']):
        return None
    copied = Item().copyItem(cal_item, creator=owner, folder=cloned_parent)
    Item().setMetadata(copied, {marker: 'true'})
    return str(copied['_id'])


def _clone_calibration_items(
    owner: types.GirderUserModel,
    source_folder: types.GirderModel,
    cloned_folder: types.GirderModel,
    multi_cam: dict,
) -> dict:
    """Copy source and JSON calibration items onto a cloned multicam parent folder."""
    updated = copy.deepcopy(multi_cam)
    source_id = updated.get(constants.CalibrationItemIdMarker) or find_calibration_item_id(
        str(source_folder['_id']), source_folder
    )
    json_id = updated.get(constants.JsonCalibrationItemIdMarker) or find_json_calibration_item_id(
        str(source_folder['_id']), source_folder
    )

    new_source_id = None
    new_json_id = None
    if source_id:
        new_source_id = _clone_calibration_item(
            owner,
            source_folder,
            cloned_folder,
            str(source_id),
            constants.CalibrationFileMarker,
        )
    if json_id and str(json_id) != str(source_id):
        new_json_id = _clone_calibration_item(
            owner,
            source_folder,
            cloned_folder,
            str(json_id),
            constants.JsonCalibrationFileMarker,
        )
    elif json_id and json_id == source_id and new_source_id:
        copied = Item().load(new_source_id, level=AccessType.WRITE, user=owner)
        if copied is not None:
            Item().setMetadata(copied, {constants.JsonCalibrationFileMarker: 'true'})
            new_json_id = new_source_id

    if new_source_id:
        updated[constants.CalibrationItemIdMarker] = new_source_id
    else:
        updated.pop(constants.CalibrationItemIdMarker, None)
    if new_json_id:
        updated[constants.JsonCalibrationItemIdMarker] = new_json_id
    else:
        updated.pop(constants.JsonCalibrationItemIdMarker, None)
    return updated


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
    media_source_folder = crud.getCloneRoot(owner, source_folder)
    cloned_folder[constants.ForeignMediaIdMarker] = str(media_source_folder['_id'])
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
        remove_camera_type_hierarchy(cloned_child)
        new_cameras[cam_name] = {
            'folderId': str(cloned_child['_id']),
            'type': cam_info.get('type') or fromMeta(child, constants.TypeMarker),
        }

    updated_multi_cam = copy.deepcopy(multi_cam)
    updated_multi_cam['cameras'] = new_cameras
    updated_multi_cam = _clone_calibration_items(
        owner, source_folder, cloned_folder, updated_multi_cam
    )
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
    cloned_folder['meta'] = copy.deepcopy(source_folder['meta'])
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
    """Return camera names in display order (shared helper, matches the client)."""
    return multicam_camera_order(multi_cam)


def _iter_multicam_camera_folders(
    multi_cam: dict,
    user: types.GirderUserModel,
) -> Iterable[Tuple[str, types.GirderModel]]:
    """Yield (camera_name, camera_folder) in display order, loading each child folder.

    Every camera entry has a folderId (crud.verify_dataset rejects a multicam dataset
    without one). Raises a 404 when a camera's folder cannot be loaded, e.g. a clone whose
    source was deleted.
    """
    cameras_meta = multi_cam.get('cameras') or {}
    for camera_name in _multicam_camera_order(multi_cam):
        child = Folder().load(
            cameras_meta[camera_name]['folderId'], level=AccessType.READ, user=user
        )
        if child is None:
            raise RestException(
                f'Camera folder for "{camera_name}" was not found',
                code=404,
            )
        yield camera_name, child


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


def _clone_root(
    folder: types.GirderModel,
    user: types.GirderUserModel,
) -> types.GirderModel:
    """The folder's media source root, or the folder itself when it is not a clone.

    crud.getCloneRoot verifies the dataset before walking, and attachment resolution runs
    mid-import (process_items) on folders that do not yet carry fps. A folder with no
    foreign-media marker is its own root, so skipping the walk skips that verification
    without changing the answer.
    """
    if not folder.get(constants.ForeignMediaIdMarker):
        return folder
    return crud.getCloneRoot(user, folder)


def _metadata_attachment(
    folder: types.GirderModel,
    user: types.GirderUserModel,
) -> Optional[Dict[str, str]]:
    """Resolve one folder's explicit metadata attachment without parsing its contents.

    The item id comes from folder metadata and can name any item in the instance, so
    membership in this scope is the guard: the item must live in ``folder`` or its clone
    root. Resolution asserts no ACL, because it cannot: a clone root is force-loaded
    (``crud.getCloneRoot``) and may be unreadable to ``user``, exactly as ``crud.valid_images``
    already lists that root's media. Access is enforced where the bytes are served -- the
    Girder item download route.
    """
    item_id = folder.get('meta', {}).get(constants.MetadataFileItemIdMarker)
    if not item_id:
        return None
    original_name = fromMeta(
        folder,
        constants.MetadataFileOriginalNameMarker,
        '',
    )
    item = Item().load(str(item_id), force=True)
    allowed_folder_ids = {
        str(folder['_id']),
        str(_clone_root(folder, user)['_id']),
    }
    if (
        item is None
        or str(item.get('folderId')) not in allowed_folder_ids
        or not constants.metadataFileRegex.search(item['name'])
    ):
        return {
            'name': original_name or 'Metadata File',
            'error': 'Metadata attachment is unavailable.',
        }
    return {'itemId': str(item['_id']), 'name': original_name or item['name']}


def _reserved_metadata_attachment(folder: types.GirderModel) -> Optional[Dict[str, str]]:
    """Resolve the singular reserved-name fallback in one folder.

    The query is the reserved-basename predicate, so every returned item is an attachment.
    Like the explicit path this establishes identity only, and for the same reason: ``folder``
    may be a force-loaded clone root, so there is no ACL for the resolver to assert.
    """
    items = list(
        Folder().childItems(
            folder,
            filters=frame_metadata.frame_metadata_source_name_query(),
        )
    )
    if len(items) > 1:
        return {
            'name': 'Metadata File',
            'error': 'More than one reserved-name metadata attachment is available.',
        }
    if not items:
        return None
    item = items[0]
    return {'itemId': str(item['_id']), 'name': item['name']}


def _first_metadata_attachment(
    folders: Iterable[Optional[types.GirderModel]],
    user: types.GirderUserModel,
    *,
    reserved: bool,
) -> Optional[Dict[str, str]]:
    """Resolve the first attachment across placement-precedence folders."""
    seen_folder_ids: set[str] = set()
    for folder in folders:
        if folder is None:
            continue
        folder_id = str(folder['_id'])
        if folder_id in seen_folder_ids:
            continue
        seen_folder_ids.add(folder_id)
        attachment = (
            _reserved_metadata_attachment(folder)
            if reserved
            else _metadata_attachment(folder, user)
        )
        if attachment is not None:
            return attachment
    return None


def resolve_metadata_attachment(
    folder: types.GirderModel,
    user: types.GirderUserModel,
) -> Optional[Dict[str, str]]:
    """Resolve one scope's metadata attachment identity.

    The single owner of "what is this scope's attachment": an explicit marker on the folder
    or its clone root first, then the reserved-name file in the same folders. Returns
    ``{itemId, name}`` when resolvable, ``{name, error}`` when declared but unavailable, and
    None when the scope has no attachment.
    """
    folders = [folder, _clone_root(folder, user)]
    explicit = _first_metadata_attachment(folders, user, reserved=False)
    if explicit is not None:
        return explicit
    return _first_metadata_attachment(folders, user, reserved=True)


def resolve_metadata_attachment_item_id(
    folder: types.GirderModel,
    user: types.GirderUserModel,
) -> Optional[str]:
    """Return the resolved attachment's item id, or None when absent or unavailable."""
    attachment = resolve_metadata_attachment(folder, user)
    if attachment is None:
        return None
    return attachment.get('itemId')


def load_frame_metadata_sources(
    dsFolder: types.GirderModel,
    user: types.GirderUserModel,
) -> dict:
    """Return one normalized metadata attachment identity per metadata scope."""
    crud.verify_dataset(dsFolder)
    source_type = fromMeta(dsFolder, constants.TypeMarker)
    if source_type == constants.MultiType:
        return _load_multicam_frame_metadata_sources(dsFolder, user)
    if source_type not in (constants.ImageSequenceType, constants.VideoType):
        return {'cameras': {}}
    shared = resolve_metadata_attachment(dsFolder, user)
    return {'shared': shared, 'cameras': {}} if shared is not None else {'cameras': {}}


def _load_multicam_frame_metadata_sources(
    dsFolder: types.GirderModel,
    user: types.GirderUserModel,
) -> dict:
    multi_cam = fromMeta(dsFolder, constants.MultiCamMarker) or {}
    shared = resolve_metadata_attachment(dsFolder, user)
    cameras: Dict[str, Dict[str, str]] = {}
    for camera_name, child in _iter_multicam_camera_folders(multi_cam, user):
        if fromMeta(child, constants.TypeMarker) not in (
            constants.ImageSequenceType,
            constants.VideoType,
        ):
            continue
        # A camera-local attachment replaces the shared one for that camera, whether it was
        # declared explicitly or by reserved name.
        attachment = resolve_metadata_attachment(child, user)
        if attachment is not None:
            cameras[camera_name] = attachment

    response: Dict[str, Any] = {'cameras': cameras}
    if shared is not None:
        response['shared'] = shared
    return response


class MetadataMutableUpdateArgs(models.MetadataMutable):
    """Update schema for mutable metadata fields"""

    class Config:
        extra = 'forbid'


def validate_metadata_shape(data: dict) -> MetadataMutableUpdateArgs:
    """Validate mutable metadata fields without changing storage."""
    return crud.get_validated_model(MetadataMutableUpdateArgs, **data)


def validate_type_hierarchy_update(
    dsFolder: types.GirderModel,
    data: dict,
    hierarchy_mode: Literal['save', 'additive'] = 'save',
) -> HierarchyWrite:
    """Resolve a metadata hierarchy instruction without changing storage."""
    try:
        return resolve_type_hierarchy(
            fromMeta(dsFolder, 'typeHierarchy'),
            'typeHierarchy' in data,
            data.get('typeHierarchy'),
            hierarchy_mode,
        )
    except TypeHierarchyError as error:
        raise crud.hierarchy_rest_error(error) from error


def update_metadata(
    dsFolder: types.GirderModel,
    data: dict,
    verify=True,
    hierarchy_mode: Literal['save', 'additive'] = 'save',
):
    """Update mutable metadata"""
    if verify:
        crud.verify_dataset(dsFolder)
    # Reload before save so concurrent convert_video metadata is not wiped.
    crud.refresh_folder_document(dsFolder)
    hierarchy_write = validate_type_hierarchy_update(dsFolder, data, hierarchy_mode)
    validated = validate_metadata_shape(data)
    validated_data = validated.dict(exclude_none=True)
    validated_data.pop('typeHierarchy', None)
    for name, value in validated_data.items():
        dsFolder['meta'][name] = value
    if hierarchy_write['action'] == 'set':
        dsFolder['meta']['typeHierarchy'] = hierarchy_write['hierarchy']
    elif hierarchy_write['action'] == 'delete':
        dsFolder['meta'].pop('typeHierarchy', None)
    # exclude_none drops explicit null, so a field the client nulls to clear it
    # must be popped by hand. timeFilters: null disables the filter;
    # cameraRegistrationSource: null drops a stale producer-provenance stamp when
    # the calibration is cleared or hand-refined.
    for nullable in ('timeFilters', 'cameraRegistrationSource'):
        if nullable in data and data[nullable] is None:
            dsFolder['meta'].pop(nullable, None)
    Folder().save(dsFolder)
    return dsFolder['meta']


def remove_camera_type_hierarchy(folder: types.GirderModel) -> bool:
    """Remove a derived hierarchy copy from a multicamera child folder.

    Returns whether a stored copy was actually removed.
    """
    if 'typeHierarchy' not in folder.get('meta', {}):
        return False
    folder['meta'].pop('typeHierarchy', None)
    Folder().save(folder)
    return True


def type_hierarchy_for_export(
    dsFolder: types.GirderModel,
    user: Optional[types.GirderUserModel] = None,
) -> Optional[Dict[str, str]]:
    """Return a normalized export hierarchy, rejecting corrupt stored metadata."""
    try:
        owner = crud.get_multicam_owner_folder(dsFolder)
        return normalize_type_hierarchy(fromMeta(owner or dsFolder, 'typeHierarchy'))
    except TypeHierarchyError as error:
        raise crud.hierarchy_rest_error(error, 'No configuration file was exported.') from error


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
        datasetInfo=fromMeta(dsFolder, "datasetInfo", {}),
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
    seen_item_ids: set[str] = set()
    for cal_item in _source_calibration_items_in_folder_root(folder_id):
        item_id = str(cal_item['_id'])
        if item_id in seen_item_ids:
            continue
        seen_item_ids.add(item_id)
        for path, file in Item().fileList(cal_item):
            for data in z.addFile(file, Path(f'{zip_path}{path}')):
                yield data
            break
    for cal_item in _json_calibration_items_in_folder_root(folder_id):
        item_id = str(cal_item['_id'])
        if item_id in seen_item_ids:
            continue
        seen_item_ids.add(item_id)
        for path, file in Item().fileList(cal_item):
            for data in z.addFile(file, Path(f'{zip_path}{path}')):
                yield data
            break


def _yield_metadata_file(
    z: ziputil.ZipGenerator,
    zip_path: str,
    folder: types.GirderModel,
    user: types.GirderUserModel,
) -> Generator[bytes, None, None]:
    """Add the folder's attachment at its archive-relative metadata path.

    ``metadata/<originalName>`` is the archive's only record of the attachment; importers
    discover it by directory, so meta.json carries no locator. Resolution already confined
    the item to this dataset's scope, and the export walks a clone's media source the same
    way, so the item is loaded without a second access check -- one that would raise
    AccessException past the ``except RestException`` guard in export_datasets_zipstream and
    abort the whole stream instead of naming the dataset in failed_datasets.txt.
    """
    attachment = resolve_metadata_attachment(folder, user)
    if attachment is None or 'itemId' not in attachment:
        return
    md_item = Item().load(attachment['itemId'], force=True)
    if md_item is None:
        return
    original_name = Path(attachment['name']).name
    for _path, file in Item().fileList(md_item):
        for data in z.addFile(file, Path(f'{zip_path}metadata/{original_name}')):
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
    includeHierarchy: bool = True,
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
        hierarchy = type_hierarchy_for_export(dsFolder, user) if includeHierarchy else None
        meta_json = meta.dict(exclude_none=True)
        meta_json.pop('typeHierarchy', None)
        if hierarchy is not None:
            meta_json['typeHierarchy'] = hierarchy
        output = {
            **meta_json,
            **media.dict(exclude_none=True),
        }
        # Attachment locators never travel in an archive: a server-local item id means
        # nothing there, and the name is already carried by metadata/<originalName>, which
        # is where both importers look. Mirrors withoutMetadataAttachment in the desktop
        # exporter (client/platform/desktop/backend/native/multicamExport.ts).
        output.pop(constants.MetadataFileItemIdMarker, None)
        output.pop(constants.MetadataFileOriginalNameMarker, None)
        yield json.dumps(output, indent=2)

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

    for data in z.addFile(makeMetajson, Path(f'{zip_path}{constants.ConfigFileName}')):
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

    if includeMedia:
        for data in _yield_metadata_file(z, zip_path, dsFolder, user):
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
    children: Dict[str, types.GirderModel],
) -> Generator[bytes, None, None]:
    """Export a multicam parent plus each child camera folder."""
    multi_cam = fromMeta(dsFolder, constants.MultiCamMarker) or {}

    def makeMultiCamJson():
        yield json.dumps(multi_cam, indent=2).encode('utf-8')

    for data in z.addFile(makeMultiCamJson, Path(f'{zip_path}multiCam.json')):
        yield data

    # The parent has no media of its own; includeMedia governs only its shared attachment.
    for data in _yield_single_dataset_export(
        z,
        zip_path,
        dsFolder,
        user,
        includeMedia,
        includeDetections,
        excludeBelowThreshold,
        typeFilter,
    ):
        yield data

    if includeMedia:
        for data in _yield_calibration_files(z, zip_path, str(dsFolder['_id'])):
            yield data

    for cam_name in _multicam_camera_order(multi_cam):
        child = children[cam_name]
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
            includeHierarchy=False,
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
    skipped_dataset_ids: Set[str] = set()
    multicam_children: Dict[str, Dict[str, types.GirderModel]] = {}

    # Validate while the REST endpoint is still building its response. Exceptions
    # raised later by a streaming generator are replaced by CherryPy's generic 500
    # body, and the caller would lose the actionable hierarchy error. A batch export
    # reports a per-dataset failure the way the stream does; a single-dataset export
    # raises, because its caller has a dataset to act on.
    single_dataset = len(dsFolders) == 1
    for dsFolder in dsFolders:
        dataset_id = str(dsFolder['_id'])
        try:
            type_hierarchy_for_export(dsFolder, user)
            if fromMeta(dsFolder, constants.TypeMarker) != constants.MultiType:
                continue
            multi_cam = fromMeta(dsFolder, constants.MultiCamMarker) or {}
            children = {}
            for cam_name in _multicam_camera_order(multi_cam):
                cam_info = multi_cam['cameras'][cam_name]
                child = Folder().load(cam_info['folderId'], level=AccessType.READ, user=user)
                if child is None:
                    raise RestException(
                        f'Camera folder for "{cam_name}" was not found',
                        code=404,
                    )
                children[cam_name] = child
            multicam_children[dataset_id] = children
        except RestException as error:
            if single_dataset:
                raise
            skipped_dataset_ids.add(dataset_id)
            failed_datasets.append(f"Dataset: {dsFolder['name']} was not exported. {error}\n")

    def stream():
        z = ziputil.ZipGenerator()
        nestedTypeFilter = typeFilter
        if nestedTypeFilter is None:
            nestedTypeFilter = set()
        for dsFolder in dsFolders:
            if str(dsFolder['_id']) in skipped_dataset_ids:
                continue
            zip_path = f"./{dsFolder['name']}/"
            source_type = fromMeta(dsFolder, constants.TypeMarker)
            try:
                if source_type == constants.MultiType:
                    get_multi_cam_media(dsFolder, user)
                else:
                    get_media(dsFolder, user)
            except (RestException, ValueError):
                failed_datasets.append(f"Dataset: {dsFolder['name']} was not found. \
                        This may be a cloned dataset where the source was deleted.\n")
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
                        multicam_children[str(dsFolder['_id'])],
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
                failed_datasets.append(f"Dataset: {dsFolder['name']} was not found. \
                        This may be a cloned dataset where the source was deleted.\n")
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
    metadataFileId: Optional[str] = None

    class Config:
        extra = 'forbid'


def _child_media_frame_count(
    child: types.GirderModel, user: types.GirderUserModel, media_type: str
) -> int:
    if media_type == constants.ImageSequenceType:
        return len(crud.valid_images(child, user))
    if media_type == constants.LargeImageType:
        return len(crud.valid_large_images(child, user))
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


def _item_has_source_calibration_marker(cal_item: dict) -> bool:
    """True when the Girder item is the original calibration upload (calibrationFile)."""
    return asbool(cal_item.get('meta', {}).get(constants.CalibrationFileMarker))


def _item_has_json_calibration_marker(cal_item: dict) -> bool:
    """True when the Girder item holds the JSON camera-rig (jsonCalibrationFile)."""
    meta = cal_item.get('meta') or {}
    if asbool(meta.get(constants.JsonCalibrationFileMarker)):
        return True
    if asbool(meta.get(constants.CalibrationFileMarker)) and cal_item['name'].lower().endswith(
        '.json'
    ):
        # Legacy datasets tagged the JSON item with calibrationFile only.
        return True
    return False


def _multi_cam_meta(folder: Optional[types.GirderModel]) -> dict:
    multi_cam = fromMeta(folder, constants.MultiCamMarker, default={}) if folder else {}
    return multi_cam if isinstance(multi_cam, dict) else {}


def _load_folder_calibration_meta(
    folder_id: str,
    folder: Optional[types.GirderModel],
) -> dict:
    multi_cam = _multi_cam_meta(folder)
    if not multi_cam:
        folder_doc = Folder().findOne({'_id': _mongo_id(folder_id)})
        multi_cam = _multi_cam_meta(folder_doc)
    return multi_cam


def _source_calibration_items_in_folder_root(folder_id: str):
    """
    Yield calibration source items stored in the dataset folder root.

    Camera media lives in child folders; only direct items on folder_id are considered.
    """
    for cal_item in Item().find({'folderId': _mongo_id(folder_id)}, sort=[('created', -1)]):
        if _item_has_source_calibration_marker(
            cal_item
        ) and constants.stereoCalibrationRegex.search(cal_item['name']):
            yield cal_item


def _json_calibration_items_in_folder_root(folder_id: str):
    """Yield items marked with meta.jsonCalibrationFile (JSON camera-rig)."""
    for cal_item in Item().find({'folderId': _mongo_id(folder_id)}, sort=[('created', -1)]):
        if _item_has_json_calibration_marker(cal_item):
            yield cal_item


def find_calibration_item_id(
    folder_id: str,
    folder: Optional[types.GirderModel] = None,
) -> Optional[str]:
    """Return the calibrationFile item id used for pipeline input."""
    multi_cam = _load_folder_calibration_meta(folder_id, folder)

    cached_id = multi_cam.get(constants.CalibrationItemIdMarker)
    if cached_id:
        cal_item = Item().findOne({'_id': _mongo_id(str(cached_id))})
        if cal_item is not None and str(cal_item.get('folderId')) == folder_id:
            if not _item_has_source_calibration_marker(cal_item):
                Item().setMetadata(cal_item, {constants.CalibrationFileMarker: 'true'})
            return str(cached_id)

    for cal_item in _source_calibration_items_in_folder_root(folder_id):
        return str(cal_item['_id'])
    return None


def find_json_calibration_item_id(
    folder_id: str,
    folder: Optional[types.GirderModel] = None,
) -> Optional[str]:
    """Return the jsonCalibrationFile item id used for calibration display."""
    multi_cam = _load_folder_calibration_meta(folder_id, folder)
    source_id = find_calibration_item_id(folder_id, folder)

    cached_id = multi_cam.get(constants.JsonCalibrationItemIdMarker)
    if cached_id:
        cal_item = Item().findOne({'_id': _mongo_id(str(cached_id))})
        if cal_item is not None and str(cal_item.get('folderId')) == folder_id:
            if not _item_has_json_calibration_marker(cal_item):
                Item().setMetadata(cal_item, {constants.JsonCalibrationFileMarker: 'true'})
            return str(cached_id)

    for cal_item in _json_calibration_items_in_folder_root(folder_id):
        item_id = str(cal_item['_id'])
        if source_id and item_id == source_id and not cal_item['name'].lower().endswith('.json'):
            continue
        return item_id

    # Legacy: JSON may still be attached to the source calibration item.
    if source_id:
        source_item = Item().findOne({'_id': _mongo_id(source_id)})
        if source_item is not None:
            files = list(Item().childFiles(source_item))
            if any(f['name'].lower().endswith('.json') for f in files):
                return source_id
    return None


def _clear_prior_calibration_items(
    folder_id: str,
    *,
    keep_source_item_id: Optional[str] = None,
) -> None:
    """Remove prior calibration items when replacing the dataset calibration."""
    for prior in _json_calibration_items_in_folder_root(folder_id):
        if keep_source_item_id and str(prior['_id']) == keep_source_item_id:
            continue
        Item().remove(prior)
    for prior in _source_calibration_items_in_folder_root(folder_id):
        if keep_source_item_id and str(prior['_id']) == keep_source_item_id:
            continue
        Item().remove(prior)


def _mark_calibration_source_item(cal_item: dict) -> None:
    Item().setMetadata(
        cal_item,
        {
            constants.CalibrationFileMarker: 'true',
            constants.JsonCalibrationFileMarker: False,
        },
    )


def _mark_calibration_source_and_json_item(cal_item: dict) -> None:
    """JSON uploads serve as both the source file and the JSON camera-rig."""
    Item().setMetadata(
        cal_item,
        {
            constants.CalibrationFileMarker: 'true',
            constants.JsonCalibrationFileMarker: 'true',
        },
    )


def _mark_frame_metadata_item(md_item: dict) -> None:
    """Tag a Girder item as frame metadata for Girder UI visualization."""
    Item().setMetadata(md_item, {constants.FrameMetadataFileMarker: 'true'})


def _validate_metadata_file_item(
    user: types.GirderUserModel,
    folder: types.GirderModel,
    item_id: str,
) -> types.GirderModel:
    """Validate a Girder item as the dataset's optional metadata file."""
    md_item = Item().load(item_id, level=AccessType.WRITE, user=user)
    if md_item is None:
        raise RestException('Metadata file was not found', code=404)
    if str(md_item.get('folderId')) != str(folder['_id']):
        raise RestException('Metadata file must be stored in the dataset folder', code=400)
    if not constants.metadataFileRegex.search(md_item['name']):
        raise RestException('Metadata file must be .json, .txt, or .csv', code=400)
    _mark_frame_metadata_item(md_item)
    return md_item


def _optional_calibration_number(data: dict, key: str) -> float | None:
    return calibration_format.optional_calibration_number(data, key)


def _parse_camera_calibration(data: dict, side: str) -> types.CameraCalibration:
    return calibration_format.parse_camera_calibration(data, side)


def _parse_stereo_calibration_json(data: dict) -> types.DatasetStereoCalibration:
    return calibration_format.parse_stereo_calibration_json(data)


def _read_json_calibration_file(
    json_file: dict,
) -> Optional[types.DatasetStereoCalibration]:
    try:
        with File().open(json_file) as fh:
            chunks = []
            while True:
                chunk = fh.read(4096)
                if not chunk:
                    break
                chunks.append(chunk)
        data = json.loads(b"".join(chunks).decode("utf-8"))
        return _parse_stereo_calibration_json(data)
    except (ValueError, KeyError, TypeError):
        return None


def _calibration_file_is_final_json(file_model: dict) -> bool:
    file_bytes = calibration_format.read_file_model_bytes(file_model)
    return calibration_format.calibration_upload_is_final_json(file_model['name'], file_bytes)


def _calibration_conversion_error(folder: types.GirderModel) -> Optional[str]:
    multi_cam = _multi_cam_meta(folder)
    error = multi_cam.get(constants.CalibrationConversionErrorMarker)
    return str(error) if error else None


def _dataset_calibration_result(
    *,
    source_item_id: Optional[str],
    json_item_id: Optional[str],
    source_name: Optional[str],
    json_path: Optional[str],
    folder: types.GirderModel,
    calibration: Optional[types.DatasetStereoCalibration] = None,
) -> types.DatasetCalibrationResult:
    result: types.DatasetCalibrationResult = {
        'itemId': source_item_id,
        'jsonItemId': json_item_id,
        'originalName': source_name,
        'jsonPath': json_path,
        'path': json_path,
    }
    if calibration is not None:
        result['calibration'] = calibration
    conversion_error = _calibration_conversion_error(folder)
    if conversion_error:
        result['conversionError'] = conversion_error
    return result


def pipeline_requires_calibration(pipeline: types.PipelineDescription) -> bool:
    """True only when pipeline metadata explicitly requires calibration input."""
    metadata = pipeline.get('metadata') or {}
    return metadata.get('requiresCalibration') is True


def resolve_stereo_calibration_item_id(
    parent_folder: types.GirderModel,
    pipeline: types.PipelineDescription,
) -> Optional[str]:
    """
    Resolve stereoscopic calibration item id for pipeline input.

    Returns an item in the dataset folder root with meta.calibrationFile set when the
    pipeline declares that calibration is required.
    """
    if not pipeline_requires_calibration(pipeline):
        return None

    folder_id = str(parent_folder['_id'])
    item_id = find_calibration_item_id(folder_id, parent_folder)
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
    if not _item_has_source_calibration_marker(cal_item):
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

    if validated.type not in (
        constants.ImageSequenceType,
        constants.VideoType,
        constants.LargeImageType,
    ):
        raise RestException(
            f'Multicam type must be image-sequence, large-image, or video, not {validated.type}',
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
    camera_types_by_name: Dict[str, str] = {}
    child_fps_by_name: Dict[str, float] = {}
    for name in camera_order:
        cam = cameras[name]
        folder_id = cam.get('folderId')
        if not folder_id:
            raise RestException(f'Camera "{name}" missing folderId', code=400)
        cam_type = cam.get('type') or validated.type
        if cam_type not in (
            constants.ImageSequenceType,
            constants.VideoType,
            constants.LargeImageType,
        ):
            raise RestException(
                f'Camera "{name}" has unsupported type {cam_type}',
                code=400,
            )
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
        if child_type != cam_type:
            raise RestException(
                f'Camera "{name}" has type {child_type}, expected {cam_type}',
                code=400,
            )
        child_fps = fromMeta(child, constants.FPSMarker)
        child_fps_by_name[name] = child_fps
        # Called for its validation side effect (e.g. a video camera missing its
        # processed video raises here); differing counts across cameras are allowed.
        _child_media_frame_count(child, user, validated.type)
        loaded_children[name] = child
        camera_types_by_name[name] = cam_type

    # fps == -1 means auto: take the children's resolved rates (video native
    # fps, or image-sequence/large-image default of 1 after post-process).
    use_auto_fps = validated.fps == -1
    if use_auto_fps:
        unique_fps = set(child_fps_by_name.values())
        if len(unique_fps) > 1:
            raise RestException(
                'All cameras must have the same fps when using auto frame rate',
                code=400,
            )
    else:
        for name, child_fps in child_fps_by_name.items():
            if child_fps != validated.fps:
                raise RestException(
                    f'Camera "{name}" has fps {child_fps}, expected {validated.fps}',
                    code=400,
                )

    # NOTE: cameras are intentionally allowed to have differing frame counts.
    # Frame alignment pairs frames across cameras downstream, so a per-camera
    # frame-count equality check would reject the primary use case for this feature.

    default_child = loaded_children[validated.defaultDisplay]
    parent_folder_doc = parent_folder
    multi_cam_cameras: Dict[str, Dict[str, str]] = {}
    for name in camera_order:
        child = loaded_children[name]
        remove_camera_type_hierarchy(child)
        if child['name'] != name:
            child['name'] = name
            Folder().save(child)
        multi_cam_cameras[name] = {
            'folderId': str(child['_id']),
            'type': camera_types_by_name[name],
        }

    calibration_source_item_id = None
    json_calibration_item_id = None
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
        calibration_source_item_id = str(cal_item['_id'])
        cal_files = list(Item().childFiles(cal_item))
        cal_file = cal_files[0] if cal_files else None
        if cal_file is not None and _calibration_file_is_final_json(cal_file):
            _mark_calibration_source_and_json_item(cal_item)
            json_calibration_item_id = calibration_source_item_id
        else:
            _mark_calibration_source_item(cal_item)
            enqueue_calibration_conversion(user, calibration_source_item_id, cal_item['name'])

    metadata_file_item_id = None
    metadata_file_name = None
    if validated.metadataFileId:
        md_item = _validate_metadata_file_item(user, parent_folder_doc, validated.metadataFileId)
        metadata_file_item_id = str(md_item['_id'])
        metadata_file_name = md_item['name']

    mutable_keys = models.MetadataMutable.schema()['properties'].keys()
    mutable_meta = {
        key: value
        for key, value in parent_folder_doc.get('meta', {}).items()
        if key in mutable_keys
    }
    parent_folder_doc['meta'] = {
        **mutable_meta,
        constants.DatasetMarker: True,
        constants.TypeMarker: constants.MultiType,
        constants.SubTypeMarker: validated.subType,
        constants.FPSMarker: fromMeta(default_child, constants.FPSMarker),
        **(
            {constants.MetadataFileItemIdMarker: metadata_file_item_id}
            if metadata_file_item_id
            else {}
        ),
        **(
            {constants.MetadataFileOriginalNameMarker: metadata_file_name}
            if metadata_file_item_id
            else {}
        ),
        constants.MultiCamMarker: {
            'defaultDisplay': validated.defaultDisplay,
            'cameraOrder': camera_order,
            'cameras': multi_cam_cameras,
            **(
                {constants.CalibrationItemIdMarker: calibration_source_item_id}
                if calibration_source_item_id
                else {}
            ),
            **(
                {constants.JsonCalibrationItemIdMarker: json_calibration_item_id}
                if json_calibration_item_id
                else {}
            ),
            **(
                {constants.CalibrationOriginalNameMarker: cal_item['name']}
                if calibration_source_item_id
                else {}
            ),
        },
    }
    parent_folder_doc['meta'].setdefault(
        constants.ConfidenceFiltersMarker,
        {'default': 0.1},
    )
    Folder().save(parent_folder_doc)
    crud.get_or_create_auxiliary_folder(parent_folder_doc, user)
    return parent_folder_doc


UNSUPPORTED_SIDE_FILE_REASON = "Unsupported side file"


def validate_files(files: List[str]):
    """
    Given a collection of filenames, classify each into a semantic upload role.

    Every filename appears under exactly one key of ``roles``; files that are not needed get
    the ``ignored`` role, and ``reasons`` maps a filename to why it landed there. Only the
    interactive browser upload honours the per-file drop, uploading the selection minus
    ``roles['ignored']`` so nothing is discarded without a reason the user can see. The
    girder-worker zip path (``dive_tasks.utils.upload_zipped_flat_media_files``) uses this as a
    whole-archive gate and then uploads every extracted file.

    ``type`` is present only when ``ok``: a rejected selection has no single media type.
    """
    # Partition frame-metadata sidecars first so they never trip the
    # generic csv/txt classification below.
    frame_meta = [f for f in files if frame_metadata.is_frame_metadata_source_name(f)]
    frame_meta_set = set(frame_meta)

    videos = [f for f in files if constants.videoRegex.search(f) and f not in frame_meta_set]
    images = [f for f in files if constants.imageRegex.search(f) and f not in frame_meta_set]
    large_images = [
        f for f in files if constants.largeImageRegEx.search(f) and f not in frame_meta_set
    ]
    media = images + videos + large_images

    # Keep dataset config filename detection aligned with the client's JsonMetaRegEx.
    dataset_config = [
        f for f in files if constants.jsonRegex.search(f) and constants.metaRegex.search(f)
    ]
    dataset_config_set = set(dataset_config)

    annotation_csvs = [f for f in files if constants.csvRegex.search(f) and f not in frame_meta_set]
    annotation_ymls = [f for f in files if constants.ymlRegex.search(f)]
    annotation_jsons = [
        f
        for f in files
        if constants.jsonRegex.search(f) and f not in dataset_config_set and f not in frame_meta_set
    ]
    annotations = annotation_csvs + annotation_ymls + annotation_jsons

    if len(videos):
        mediatype = constants.VideoType
    elif len(images):
        mediatype = constants.ImageSequenceType
    elif len(large_images):
        mediatype = constants.LargeImageType
    else:
        mediatype = ""

    ok = True
    message = ""
    if len(videos) and (len(images) or len(large_images)):
        ok = False
        message = "Do not upload images and videos in the same batch."
    elif len(large_images) and len(images):
        ok = False
        message = "Do not upload images and tile images in the same batch."
    elif len(annotation_csvs) > 1:
        ok = False
        message = "Can only upload a single CSV Annotation per import"
    elif len(frame_meta) > 1:
        ok = False
        message = "More than one metadata file was selected. Choose one file and try again."
    elif len(dataset_config) > 1:
        ok = False
        message = "Can only upload a single configuration JSON per import"
    elif len(annotation_jsons) > 1:
        ok = False
        message = "Can only upload a single annotation JSON per import"
    elif len(annotation_csvs) and len(annotation_ymls):
        ok = False
        message = "Cannot mix annotation import types"
    elif len(annotation_ymls) > 1:
        ok = False
        message = "Can only upload a single YAML Annotation per import"
    elif len(annotation_csvs) + len(annotation_ymls) + len(annotation_jsons) > 1:
        # Multiple annotation sources across formats (e.g. CSV + JSON) would silently
        # overwrite each other at import, so only one annotation source is allowed.
        ok = False
        message = "Cannot mix annotation import types"
    elif len(videos) > 1 and (len(annotations) or len(dataset_config)):
        ok = False
        message = "Annotation upload is not supported when multiple videos are uploaded"
    elif not (len(videos) or len(images) or len(large_images)):
        ok = False
        message = "No supported media-type files found"

    # A metadata attachment is stored for every dataset type; read time decides what to do
    # with it, so there is no media-type gate here.
    accepted = set(media) | set(annotations) | set(dataset_config) | frame_meta_set
    ignored = [f for f in files if f not in accepted]

    return {
        "ok": ok,
        # Only an accepted selection has a media type.
        **({"type": mediatype} if ok else {}),
        "message": message,
        "roles": {
            "media": media,
            "annotations": annotations,
            "datasetConfig": dataset_config,
            "frameMetadata": frame_meta,
            "ignored": ignored,
        },
        "reasons": {f: UNSUPPORTED_SIDE_FILE_REASON for f in ignored},
    }


def get_calibration(
    user: types.GirderUserModel,
    folder: types.GirderModel,
) -> types.DatasetCalibrationResult | None:
    folder_id_str = str(folder["_id"])
    dataset_type = fromMeta(folder, "type", required=True)

    if dataset_type != constants.MultiType:
        raise RestException(
            'Cannot search for calibration file on non stereo/multicam datasets', code=400
        )

    source_item_id = find_calibration_item_id(folder_id_str, folder)
    json_item_id = find_json_calibration_item_id(folder_id_str, folder)
    if source_item_id is None and json_item_id is None:
        return None

    multi_cam = _multi_cam_meta(folder)
    source_name = multi_cam.get(constants.CalibrationOriginalNameMarker)
    if source_item_id and not source_name:
        source_item = Item().load(source_item_id, level=AccessType.READ, user=user)
        if source_item is not None:
            source_name = source_item['name']

    json_path = None
    json_file_model = None
    if json_item_id:
        json_item = Item().load(json_item_id, level=AccessType.READ, user=user)
        if json_item is not None:
            json_files = list(Item().childFiles(json_item))
            json_file_model = next(
                (f for f in json_files if f['name'].lower().endswith('.json')),
                json_files[0] if json_files else None,
            )
            if json_file_model is not None:
                json_path = json_file_model['name']

    if json_file_model is not None:
        dataset_calibration = _read_json_calibration_file(json_file_model)
        if dataset_calibration is not None:
            return _dataset_calibration_result(
                source_item_id=source_item_id,
                json_item_id=json_item_id,
                source_name=source_name,
                json_path=json_path,
                folder=folder,
                calibration=dataset_calibration,
            )

    return _dataset_calibration_result(
        source_item_id=source_item_id,
        json_item_id=json_item_id,
        source_name=source_name,
        json_path=json_path,
        folder=folder,
    )


def enqueue_calibration_conversion(
    user: types.GirderUserModel,
    item_id: str,
    item_name: str,
) -> None:
    """
    Kick off a background worker job to convert a calibrationFile item to a separate
    jsonCalibrationFile JSON camera-rig item for display.
    """
    job_is_private = user.get(constants.UserPrivateQueueEnabledMarker, False)
    # convert_cam_format.py lives on pipeline workers (VIAME image), not celery workers.
    queue = f'{user["login"]}@private' if job_is_private else 'pipelines'
    token = Token().createToken(user=user, days=1)
    tasks.convert_calibration.apply_async(
        queue=queue,
        kwargs=dict(
            itemId=item_id,
            girder_job_title=f"Converting calibration {item_name}",
            girder_client_token=str(token["_id"]),
            girder_job_type="private" if job_is_private else "pipelines",
        ),
    )


def set_calibration(
    user: types.GirderUserModel,
    folder: types.GirderModel,
    file_id: str,
) -> dict:
    """
    Mark an already-uploaded Girder file as the dataset's stereoscopic calibration.

    The file must live in the dataset (multicam parent) folder root. Any previously
    marked calibration item in that root is unmarked so the newest selection wins.
    """
    if fromMeta(folder, "type", required=True) != constants.MultiType:
        raise RestException('Calibration is only supported for stereo/multicam datasets', code=400)
    if fromMeta(folder, constants.SubTypeMarker, required=False) != 'stereo':
        raise RestException('Calibration is only supported for stereo datasets', code=400)

    file = File().load(file_id, level=AccessType.READ, user=user)
    if file is None:
        raise RestException('Calibration file was not found', code=404)
    if not constants.stereoCalibrationRegex.search(file['name']):
        raise RestException(
            'Calibration file must be .npz, .json, .cam, .yml, or .zip',
            code=400,
        )

    cal_item = Item().load(file['itemId'], level=AccessType.WRITE, user=user)
    if cal_item is None or str(cal_item.get('folderId')) != str(folder['_id']):
        raise RestException('Calibration file must be stored in the dataset folder', code=400)

    folder_id = str(folder['_id'])
    _clear_prior_calibration_items(folder_id, keep_source_item_id=str(cal_item['_id']))

    multi_cam = dict(folder['meta'].get(constants.MultiCamMarker, {}))
    multi_cam[constants.CalibrationItemIdMarker] = str(cal_item['_id'])
    multi_cam[constants.CalibrationOriginalNameMarker] = file['name']
    multi_cam.pop(constants.JsonCalibrationItemIdMarker, None)
    multi_cam.pop(constants.CalibrationConversionErrorMarker, None)

    if _calibration_file_is_final_json(file):
        _mark_calibration_source_and_json_item(cal_item)
        multi_cam[constants.JsonCalibrationItemIdMarker] = str(cal_item['_id'])
    else:
        _mark_calibration_source_item(cal_item)
        enqueue_calibration_conversion(user, str(cal_item['_id']), cal_item['name'])

    folder['meta'][constants.MultiCamMarker] = multi_cam
    Folder().save(folder)

    return {
        'calibrationItemId': str(cal_item['_id']),
        'jsonCalibrationItemId': multi_cam.get(constants.JsonCalibrationItemIdMarker),
    }


def set_metadata_file(
    user: types.GirderUserModel,
    folder: types.GirderModel,
    item_id: str,
) -> dict:
    """
    Mark an already-uploaded Girder item as the dataset's optional metadata file.

    Applies to single and multicam datasets. The item must live in the dataset
    folder root. Handed to opt-in pipelines at run time (see the pipe
    `# Metadata File:` header).
    """
    # Supersede cleanup removes only an attachment DIVE itself stored. A reserved-name file
    # is the user's own folder content, uploaded with the media and merely discovered by
    # resolution -- and process_items records what it discovers in this same marker, so the
    # marker alone cannot tell the two apart. The name can: replacing the attachment shadows
    # a reserved-name file, and deleting it would destroy a file the user uploaded.
    md_item = _validate_metadata_file_item(user, folder, item_id)
    # Girder's save is a full-document replace and async jobs (convert_video) write folder
    # meta while callers hold this document, so refresh first or their keys (annotate,
    # originalFps, ffprobe_info) are replaced with this stale in-memory copy.
    crud.refresh_folder_document(folder)
    declared_item_id = folder.get('meta', {}).get(constants.MetadataFileItemIdMarker)
    previous_item_id = str(declared_item_id) if declared_item_id else None
    previous_item = None
    if previous_item_id and previous_item_id != str(md_item['_id']):
        candidate = Item().load(previous_item_id, level=AccessType.WRITE, user=user)
        if (
            candidate is not None
            and str(candidate.get('folderId')) == str(folder['_id'])
            and not frame_metadata.is_frame_metadata_source_name(candidate['name'])
        ):
            previous_item = candidate
    folder['meta'][constants.MetadataFileItemIdMarker] = str(md_item['_id'])
    folder['meta'][constants.MetadataFileOriginalNameMarker] = md_item['name']
    Folder().save(folder)
    if previous_item is not None:
        try:
            Item().remove(previous_item)
        except Exception:
            cherrypy.log(
                f'Unable to remove superseded metadata attachment {previous_item["_id"]}',
                traceback=True,
            )
    return {
        'metadataFileItemId': str(md_item['_id']),
        'metadataFileOriginalName': md_item['name'],
    }
