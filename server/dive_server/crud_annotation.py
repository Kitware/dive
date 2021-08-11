from typing import List

from girder.exceptions import RestException
from girder.models.file import File
from pydantic.main import BaseModel

from dive_server import crud
from dive_utils import models, types


def get_annotations(dsFolder: types.GirderModel):
    crud.verify_dataset(dsFolder)
    file = crud.detections_file(dsFolder)
    if file is None:
        return {}
    if "csv" in file["exts"]:
        raise RestException('Cannot get detections until postprocessing is complete.')
    return File().download(file, contentDisposition="inline")


class AnnotationUpdateArgs(BaseModel):
    delete: List[int] = []
    upsert: List[models.Track] = []

    class Config:
        extra = 'forbid'


def save_annotations(dsFolder: types.GirderModel, user: types.GirderUserModel, data: dict):
    crud.verify_dataset(dsFolder)
    track_dict = crud.getTrackData(crud.detections_file(dsFolder))
    validated: AnnotationUpdateArgs = crud.get_validated_model(AnnotationUpdateArgs, **data)

    for track_id in validated.delete:
        track_dict.pop(str(track_id), None)
    for track in validated.upsert:
        track_dict[str(track.trackId)] = track.dict(exclude_none=True)

    upserted_len = len(validated.delete)
    deleted_len = len(validated.upsert)

    if upserted_len or deleted_len:
        crud.saveTracks(dsFolder, track_dict, user)

    return {
        "updated": upserted_len,
        "deleted": deleted_len,
    }
