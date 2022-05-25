from typing import Any

from dive_utils import constants, models, types


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
        return types.DIVEAnnotationSchema(
            tracks=tracks, groups=groups, version=constants.AnnotationsCurrentVersion
        )
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
