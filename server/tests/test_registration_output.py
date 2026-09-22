"""Ingesting align_cameras output back into a web dataset's registration meta."""

import json
from pathlib import Path

import pytest

from dive_tasks.registration_output import ingest_registration_output


class FakeGirderClient:
    """Records the PATCH body so a merge can be asserted without a server."""

    def __init__(self, dataset=None):
        self.dataset = dataset or {}
        self.patched = None

    def get(self, _path):
        return self.dataset

    def sendRestRequest(self, method, path, json=None):
        self.patched = (method, path, json)
        return {}


def _write(tmp_path: Path, pairs, version=2) -> Path:
    path = tmp_path / 'registration.json'
    path.write_text(
        json.dumps({'type': 'dive-camera-registration', 'version': version, 'pairs': pairs}),
        encoding='utf-8',
    )
    return path


def _pair(image_left, image_right):
    return {
        'left': 'G336',
        'right': 'G337',
        'transformType': 'homography',
        'observations': [
            {
                'imageLeft': image_left,
                'imageRight': image_right,
                'source': 'matcher',
                'points': [[1, 2, 3, 4]],
            }
        ],
    }


def test_ingest_maps_extracted_video_frames_back(tmp_path: Path):
    """Video cameras run over extracted stills; the meta must keep frame://N."""
    gc = FakeGirderClient()
    path = _write(tmp_path, [_pair('G336.frame_12.png', 'G337.frame_30.png')])

    assert ingest_registration_output(gc, 'folder', path, ['G336', 'G337']) == 1

    observations = gc.patched[2]['cameraCorrespondences']['G336::G337']
    assert observations[0]['imageA'] == 'frame://12'
    assert observations[0]['imageB'] == 'frame://30'


def test_ingest_leaves_image_sequence_names_alone(tmp_path: Path):
    """Only the cameras named as video are remapped; image names are identities."""
    gc = FakeGirderClient()
    path = _write(tmp_path, [_pair('G336.frame_12.png', '000030.png')])

    ingest_registration_output(gc, 'folder', path, ['G336'])

    observations = gc.patched[2]['cameraCorrespondences']['G336::G337']
    assert observations[0]['imageA'] == 'frame://12'
    assert observations[0]['imageB'] == '000030.png'


def test_ingest_without_video_cameras_passes_names_through(tmp_path: Path):
    gc = FakeGirderClient()
    path = _write(tmp_path, [_pair('000012.png', '000030.png')])

    ingest_registration_output(gc, 'folder', path)

    observations = gc.patched[2]['cameraCorrespondences']['G336::G337']
    assert observations[0]['imageA'] == '000012.png'


def test_ingest_rejects_non_v2(tmp_path: Path):
    gc = FakeGirderClient()
    path = _write(tmp_path, [_pair('a.png', 'b.png')], version=1)
    with pytest.raises(ValueError, match='version'):
        ingest_registration_output(gc, 'folder', path)
