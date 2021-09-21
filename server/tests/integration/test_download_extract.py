import os
import pytest
import urllib.request
import zipfile
from girder_client import GirderClient

from .conftest import localDataRoot

source_api_root = 'https://viame.kitware.com/api/v1/'
sample_data = [
    ('607ded8b1d59f90549235c3d', 'stereo.zip'),
    ('6006dfb9f751cc24d135ec29', 'TestData.zip'),
]
gc = GirderClient(apiUrl=source_api_root)
gc.authenticate(apiKey=os.environ.get('GIRDER_API_KEY'))


@pytest.mark.integration
@pytest.mark.parametrize("data", sample_data)
@pytest.mark.run(order=1)
def test_extract_download(data):
    fileId, filename = data
    filepath = localDataRoot / str(filename)
    if not filepath.exists():
        gc.downloadFile(fileId, str(filepath))
        with zipfile.ZipFile(filepath, 'r') as zipref:
            zipref.extractall(localDataRoot)
