"""Resolve a dataset frame or calibration to a path the interactive service
can open. The service runs on a host that mounts the same assetstore girder
writes to, so the assetstore's own file paths are used as they are."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item

from dive_server import crud, crud_dataset
from dive_utils import constants, fromMeta, types


def item_path(item: types.GirderModel) -> str:
    file = File().findOne({'itemId': item['_id']})
    if file is None:
        raise RestException(f'Item {item["name"]} has no file', code=404)
    adapter = File().getAssetstoreAdapter(file)
    if not hasattr(adapter, 'fullPath'):
        raise RestException('Interactive tools need a filesystem assetstore', code=501)
    return adapter.fullPath(file)


def camera_order(dsFolder: types.GirderModel) -> List[str]:
    multi_cam = fromMeta(dsFolder, constants.MultiCamMarker) or {}
    if not multi_cam:
        return []
    # The calibration's left camera is first, as the client also assumes.
    return list(crud_dataset._multicam_camera_order(multi_cam))  # noqa: SLF001


def camera_folder(
    dsFolder: types.GirderModel, camera: Optional[str], user: types.GirderUserModel
) -> types.GirderModel:
    if fromMeta(dsFolder, constants.TypeMarker) != constants.MultiType:
        return dsFolder
    multi_cam = fromMeta(dsFolder, constants.MultiCamMarker) or {}
    cameras = multi_cam.get('cameras') or {}
    name = camera or multi_cam.get('defaultDisplay')
    info = cameras.get(name) if name else None
    if not info or not info.get('folderId'):
        raise RestException(f'Unknown camera "{camera}"', code=400)
    folder = Folder().load(info['folderId'], level=AccessType.READ, user=user)
    if folder is None:
        raise RestException(f'Camera folder for "{name}" was not found', code=404)
    return folder


def frame_media(
    folder: types.GirderModel, frame: int, user: types.GirderUserModel
) -> Dict[str, Any]:
    """`{'path', 'frameTime'}` for one frame of a single-camera folder."""
    source_type = fromMeta(folder, constants.TypeMarker)
    if source_type == constants.VideoType:
        root = crud.getCloneRoot(user, folder)
        video = Item().findOne(
            {'folderId': root['_id'], 'meta.codec': 'h264', 'meta.source_video': {'$in': [None, False]}}
        )
        if video is None:
            raise RestException('The dataset has no transcoded video', code=404)
        fps = fromMeta(folder, constants.FPSMarker) or fromMeta(root, constants.FPSMarker)
        if not fps:
            raise RestException('The dataset has no frame rate', code=400)
        return {'path': item_path(video), 'frameTime': frame / float(fps)}
    if source_type == constants.ImageSequenceType:
        images = crud.valid_images(folder, user)
        if frame < 0 or frame >= len(images):
            raise RestException(f'Frame {frame} is outside the dataset', code=400)
        return {'path': item_path(images[frame]), 'frameTime': None}
    raise RestException(
        f'Interactive tools do not support {source_type} datasets', code=501
    )


def resolve_frame(
    dsFolder: types.GirderModel, camera: Optional[str], frame: int, user: types.GirderUserModel
) -> Dict[str, Any]:
    return frame_media(camera_folder(dsFolder, camera, user), frame, user)


def calibration_path(dsFolder: types.GirderModel, user: types.GirderUserModel) -> Optional[str]:
    item_id = crud_dataset.find_calibration_item_id(str(dsFolder['_id']), dsFolder)
    if not item_id:
        return None
    item = Item().load(item_id, level=AccessType.READ, user=user)
    if item is None:
        return None
    return item_path(item)
