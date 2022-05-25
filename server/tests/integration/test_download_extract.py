import os
import zipfile

from girder_client import GirderClient
import pytest

from .conftest import localDataRoot

source_api_root = 'https://viame.kitware.com/api/v1/'
sample_data = [
    ('607ded8b1d59f90549235c3d', 'stereo.zip'),
    ('628536740d73979483eeab4c', 'TestData.zip'),
    ('61646cf37c93704c9952e84d', 'kwcoco.zip'),
    ('619cf1f87a958c6b1f255c2c', 'zipTestFiles.zip'),
]


@pytest.mark.integration
@pytest.mark.parametrize("data", sample_data)
@pytest.mark.run(order=1)
def test_extract_download(data):
    fileId, filename = data
    filepath = localDataRoot / str(filename)
    if not filepath.exists():
        gc = GirderClient(apiUrl=source_api_root)
        gc.authenticate(apiKey=os.environ.get('GIRDER_API_KEY'))
        gc.downloadFile(fileId, str(filepath))
        with zipfile.ZipFile(filepath, 'r') as zipref:
            zipref.extractall(localDataRoot)


@pytest.mark.integration
@pytest.mark.run(order=1)
def test_sanity_checks():
    gc = GirderClient(apiUrl=source_api_root)
    resp = gc.get('/', jsonResp=False)
    assert resp.status_code == 200
    assert resp.headers['Content-Type'] == 'text/html;charset=utf-8'
    resp = gc.get('system/check', jsonResp=False)
    assert resp.status_code == 200
