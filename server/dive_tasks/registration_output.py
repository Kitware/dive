"""
Ingest align_cameras pipeline output (a DIVE camera-registration JSON,
format v2) into a web dataset's saved registration meta.

The server-side counterpart of the desktop backend's
ingestPipelineRegistration: parse the job's registration.json, rebuild the
cameraHomographies / cameraCorrespondences / cameraTransformTypes meta
fragments, and merge them into the dataset's current meta AT OBSERVATION
GRANULARITY -- an incoming observation replaces the existing observation
with the same (image pair, source) identity, hand-picked observations the
job didn't cover survive, and pairs the job didn't name are untouched.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from girder_client import GirderClient

MANUAL_SOURCE = 'manual'


def _invert3(m: List[List[float]]) -> Optional[List[List[float]]]:
    """Inverse of a row-major 3x3 matrix, or None when singular."""
    a, b, c = m[0]
    d, e, f = m[1]
    g, h, i = m[2]
    det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if abs(det) < 1e-12:
        return None
    adj = [
        [e * i - f * h, c * h - b * i, b * f - c * e],
        [f * g - d * i, a * i - c * g, c * d - a * f],
        [d * h - e * g, b * g - a * h, a * e - b * d],
    ]
    return [[value / det for value in row] for row in adj]


def _observation_identity(obs: Dict[str, Any]) -> str:
    return f"{obs.get('imageA')} {obs.get('imageB')} {obs.get('source')}"


def _from_registration_pairs(pairs: List[Dict[str, Any]], next_id: int):
    """Rebuild meta fragments from v2 file pairs (mirrors the client parser)."""
    homographies: Dict[str, Any] = {}
    observations: Dict[str, Any] = {}
    transform_types: Dict[str, Any] = {}
    for pair in pairs:
        key = f"{pair['left']}::{pair['right']}"
        left_to_right = pair.get('leftToRight')
        right_to_left = pair.get('rightToLeft')
        if left_to_right or right_to_left:
            a_to_b = left_to_right or _invert3(right_to_left)
            b_to_a = right_to_left or _invert3(left_to_right)
            if a_to_b is not None and b_to_a is not None:
                homographies[key] = {'AtoB': a_to_b, 'BtoA': b_to_a}
        rows = []
        for obs in pair.get('observations') or []:
            points = []
            for row in obs.get('points') or []:
                next_id += 1
                points.append({
                    'id': next_id,
                    'a': [row[0], row[1]],
                    'b': [row[2], row[3]],
                })
            rows.append({
                'imageA': obs['imageLeft'],
                'imageB': obs['imageRight'],
                # The client re-resolves frames from the image names on load.
                'frame': obs.get('frame'),
                'enabled': obs.get('enabled', True),
                'source': obs.get('source') or MANUAL_SOURCE,
                **({'stats': obs['stats']} if obs.get('stats') is not None else {}),
                'points': points,
            })
        if rows:
            observations[key] = rows
        transform_types[key] = pair.get('transformType') or 'homography'
    return homographies, observations, transform_types


def ingest_registration_output(
    gc: GirderClient,
    folder_id: str,
    registration_path: Path,
) -> int:
    """Merge a pipeline registration JSON into the dataset meta.

    Returns the number of pairs merged. Raises ValueError on a malformed or
    non-v2 file (one format, one loader -- a pre-v2 file would otherwise
    load as matrix-only pairs with points silently dropped).
    """
    with open(registration_path, encoding='utf-8') as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or not isinstance(data.get('pairs'), list):
        raise ValueError('Not a DIVE camera registration file (expected a "pairs" list)')
    if data.get('version') != 2:
        raise ValueError(
            f"Unsupported registration file version {data.get('version')!r} (expected 2)"
        )

    current = gc.get(f'dive_dataset/{folder_id}')
    homographies = dict(current.get('cameraHomographies') or {})
    observations = {
        key: list(value)
        for key, value in (current.get('cameraCorrespondences') or {}).items()
    }
    transform_types = dict(current.get('cameraTransformTypes') or {})

    max_id = 0
    for rows in observations.values():
        for obs in rows:
            for point in obs.get('points') or []:
                max_id = max(max_id, int(point.get('id', 0)))

    incoming_h, incoming_obs, incoming_t = _from_registration_pairs(data['pairs'], max_id)

    named = set(incoming_h) | set(incoming_obs) | set(incoming_t)
    for key in named:
        homographies.pop(key, None)
        transform_types.pop(key, None)
        if key in incoming_h:
            homographies[key] = incoming_h[key]
        if key in incoming_t:
            transform_types[key] = incoming_t[key]
        incoming_rows = incoming_obs.get(key) or []
        if incoming_rows:
            replaced = {_observation_identity(obs) for obs in incoming_rows}
            observations[key] = [
                obs for obs in observations.get(key, [])
                if _observation_identity(obs) not in replaced
            ] + incoming_rows
        elif key in incoming_h or key in incoming_t:
            # A matrix-only pair replaces the pair as an artifact.
            observations.pop(key, None)

    gc.sendRestRequest(
        'PATCH',
        f'dive_dataset/{folder_id}',
        json={
            'cameraHomographies': homographies,
            'cameraCorrespondences': observations,
            'cameraTransformTypes': transform_types,
        },
    )
    return len(named)
