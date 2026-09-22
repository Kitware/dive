"""Fetching a dataset's media for a pipeline run, per media type."""

from pathlib import Path

import pytest

from dive_tasks import utils
from dive_utils import constants


class FakeGirderClient:
    """Answers the two dive_dataset reads download_source_media makes."""

    urlBase = 'http://girder:8080/api/v1/'

    def __init__(self, dataset_type: str, images):
        self.dataset_type = dataset_type
        self.images = images

    def get(self, path: str):
        if path.endswith('/media'):
            return {'imageData': self.images, 'video': None, 'sourceVideo': None}
        return {
            'id': 'ds1',
            'name': 'ir',
            'createdAt': '2026-09-02 16:37:43.583000+00:00',
            'type': self.dataset_type,
            'fps': 10.0,
            'annotate': True,
            'confidenceFilters': {'default': 0.1},
        }


def _image(index: int, ext: str, url: str):
    return {'id': f'item{index}', 'url': url, 'filename': f'frame_{index}.{ext}'}


@pytest.fixture
def retrieved(monkeypatch):
    """Record (url, destination) for every download instead of fetching."""
    calls = []

    def fake_urlretrieve(url, filename=None):
        Path(filename).write_bytes(b'')
        calls.append((url, str(filename)))

    monkeypatch.setattr(utils.request, 'urlretrieve', fake_urlretrieve)
    return calls


def test_large_image_downloads_the_file_not_the_tile_metadata(tmp_path: Path, retrieved):
    """A large-image camera's imageData url points at girder's tile server."""
    images = [
        _image(0, 'tif', 'api/v1/item/item0/tiles/internal_metadata'),
        _image(1, 'tif', 'api/v1/item/item1/tiles/internal_metadata'),
    ]
    gc = FakeGirderClient(constants.LargeImageType, images)

    media_list, media_type = utils.download_source_media(gc, 'ds1', tmp_path)

    assert media_type == constants.LargeImageType
    assert media_list == [str(tmp_path / 'frame_0.tif'), str(tmp_path / 'frame_1.tif')]
    assert [url for url, _ in retrieved] == [
        'http://girder:8080/api/v1/dive_dataset/ds1/media/item0/download',
        'http://girder:8080/api/v1/dive_dataset/ds1/media/item1/download',
    ]
    # Local names are the dataset's own image names: the image list VIAME reads
    # and any registration observation keyed on them must agree with the viewer.
    assert [Path(dest).name for _, dest in retrieved] == ['frame_0.tif', 'frame_1.tif']


def test_image_sequence_still_uses_the_url_the_server_gave(tmp_path: Path, retrieved):
    images = [_image(0, 'png', '/api/v1/dive_dataset/ds1/media/item0/download')]
    gc = FakeGirderClient(constants.ImageSequenceType, images)

    media_list, media_type = utils.download_source_media(gc, 'ds1', tmp_path)

    assert media_type == constants.ImageSequenceType
    assert media_list == [str(tmp_path / 'frame_0.png')]
    assert retrieved[0][0] == 'http://girder:8080/api/v1/dive_dataset/ds1/media/item0/download'


def test_unsupported_media_type_still_reports_the_metadata(tmp_path: Path, retrieved):
    gc = FakeGirderClient(constants.MultiType, [])

    with pytest.raises(Exception, match='unexpected metadata'):
        utils.download_source_media(gc, 'ds1', tmp_path)
