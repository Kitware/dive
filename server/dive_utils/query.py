"""Validation and portable file handling for web query jobs."""

import math
from pathlib import Path
import shutil
import zipfile


def validate_query_request(body):
    if not isinstance(body, dict):
        raise ValueError('Expected a query request.')
    operation = body.get('operation')
    if operation == 'index':
        method = body.get('method', 'detections')
        if method not in ('detections', 'tracking', 'existing', 'frames'):
            raise ValueError('Invalid indexing method.')
        if not isinstance(body.get('datasetId'), str) or not body['datasetId']:
            raise ValueError('Choose a dataset.')
        return {'operation': operation, 'datasetId': body['datasetId'], 'method': method}
    if operation != 'search':
        raise ValueError('Unknown query operation.')
    indexes = body.get('indexIds')
    if (
        not isinstance(indexes, list)
        or not 1 <= len(indexes) <= 32
        or any(not isinstance(i, str) or not i for i in indexes)
        or len(set(indexes)) != len(indexes)
    ):
        raise ValueError('Select between 1 and 32 distinct indexes.')
    image = body.get('image')
    if not isinstance(image, str) or not 0 < len(image) <= 14_000_000:
        raise ValueError('Choose a PNG exemplar smaller than 10 MB.')
    boxes = body.get('boxes', [])
    if not isinstance(boxes, list) or len(boxes) > 1:
        raise ValueError('Choose at most one exemplar box.')
    for box in boxes:
        if (
            not isinstance(box, list)
            or len(box) != 4
            or any(type(x) not in (int, float) or not math.isfinite(x) or x < 0 for x in box)
            or box[0] >= box[2]
            or box[1] >= box[3]
        ):
            raise ValueError('Invalid exemplar box.')
    feedback = body.get('feedback', [])
    if not isinstance(feedback, list) or len(feedback) > 20:
        raise ValueError('At most 20 refinement rounds are supported.')
    for round in feedback:
        if not isinstance(round, dict) or set(round) != {'positive', 'negative'}:
            raise ValueError('Invalid query feedback.')
        for values in round.values():
            if (
                not isinstance(values, list)
                or len(values) > 500
                or any(not isinstance(key, str) or len(key) > 128 for key in values)
            ):
                raise ValueError('Invalid feedback result keys.')
        if (
            not round['positive']
            and not round['negative']
            or set(round['positive']) & set(round['negative'])
        ):
            raise ValueError('Mark distinct results correct or incorrect before refining.')
    return {
        'operation': operation,
        'indexIds': indexes,
        'image': image,
        'boxes': boxes,
        'feedback': feedback,
    }


def extract_index(archive, destination):
    """Unpack untrusted Girder bytes without following archive paths or links."""
    root = Path(destination).resolve()
    with zipfile.ZipFile(archive) as zipped:
        for info in zipped.infolist():
            path = root / info.filename
            if (
                not path.resolve().is_relative_to(root)
                or '\\' in info.filename
                or (info.external_attr >> 16) & 0o170000 == 0o120000
            ):
                raise ValueError('Unsafe index archive path.')
            if info.is_dir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(info) as source, path.open('wb') as target:
                    shutil.copyfileobj(source, target)
