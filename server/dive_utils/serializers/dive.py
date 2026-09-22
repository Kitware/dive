import math
from typing import Any, Optional

from dive_utils import constants, models, types


def frame_rate_from_dive(data: Any) -> Optional[float]:
    """Annotation FPS recorded on a DIVE JSON document, if usable.

    Same rules as the VIAME CSV ``fps:`` header and COCO ``videos[].annotation_fps``:
    a finite number greater than zero. Absent or unusable values are not an error.
    """
    if not isinstance(data, dict):
        return None
    rate = data.get('fps')
    if isinstance(rate, bool) or not isinstance(rate, (int, float)):
        return None
    if math.isfinite(rate) and rate > 0:
        return float(rate)
    return None


def migrate(jsonData: Any) -> types.DIVEAnnotationSchema:
    """Migrate and validate a dictionary to make sure it's a DIVE json schema'd file"""
    if not isinstance(jsonData, dict):
        raise ValueError('object expected in dive json file')
    version = jsonData.get('version', 1)
    if version == constants.AnnotationsCurrentVersion:
        tracks = {
            str(trackId): models.Track(**track).dict(exclude_none=True)
            for trackId, track in jsonData['tracks'].items()
        }
        groups = {
            str(groupId): models.Group(**group).dict(exclude_none=True)
            for groupId, group in jsonData['groups'].items()
        }
        migrated: types.DIVEAnnotationSchema = types.DIVEAnnotationSchema(
            tracks=tracks, groups=groups, version=constants.AnnotationsCurrentVersion
        )
        fps = frame_rate_from_dive(jsonData)
        if fps is not None:
            migrated['fps'] = fps
        return migrated
    elif version == 1:
        for track in jsonData.values():
            track['id'] = track['trackId']
            del track['trackId']
        return migrate(
            {
                'tracks': jsonData,
                'groups': {},
                'version': constants.AnnotationsCurrentVersion,
            }
        )
    raise ValueError(f'Version unknown: {version}')
