from typing import Any

from dive_utils import constants


def migrate(jsonData: Any):
    if not isinstance(jsonData, dict):
        raise ValueError('object expected in dive json file')
    version = jsonData.get('version', 1)
    if version == constants.AnnotationsCurrentVersion:
        return jsonData
    elif version == 1:
        for track in jsonData.values():
            track['id'] = track['trackId']
            del track['trackId']
        return {
            'tracks': jsonData,
            'groups': {},
            'version': constants.AnnotationsCurrentVersion,
        }
