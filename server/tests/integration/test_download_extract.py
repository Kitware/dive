import io
import os
import zipfile

from PIL import Image
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
def test_ensure_nested_zip_uppercase_fixture():
    """Build a nested ``.ZIP`` fixture locally (integration data/ is not in git)."""
    dest_dir = localDataRoot / 'zipTestFiles'
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / 'nestedZipUppercase.zip'
    png_buf = io.BytesIO()
    Image.new('RGB', (8, 8), 'red').save(png_buf, format='PNG')
    inner_buf = io.BytesIO()
    with zipfile.ZipFile(inner_buf, 'w') as inner:
        inner.writestr('readme.txt', 'nested archive for case-sensitivity test\n')
    with zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED) as outer:
        outer.writestr('frame001.png', png_buf.getvalue())
        outer.writestr('sidecar.ZIP', inner_buf.getvalue())
    assert dest.is_file()


@pytest.mark.integration
@pytest.mark.run(order=1)
def test_sanity_checks():
    gc = GirderClient(apiUrl=source_api_root)
    resp = gc.get('/', jsonResp=False)
    assert resp.status_code == 200
    assert resp.headers['Content-Type'] == 'text/html;charset=utf-8'
    resp = gc.get('system/check', jsonResp=False)
    assert resp.status_code == 200
