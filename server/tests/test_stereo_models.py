import hashlib
import io
from pathlib import Path
import zipfile

import pytest

from dive_utils import stereo_models

CSV = (
    'DEFAULT-FISH, https://example.com/fish/download, Default fish, '
    '1b71862b7fa39def315c0c08c44048a7, ALL-PLATFORMS, "PYTORCH, ONNX", models/fish.zip\n'
    'FAST-FDN-STEREO, https://example.com/stereo/download, Fast foundation stereo,  '
    '29D4CDE2E33500E74844D07C5AB3DEE0, ALL-PLATFORMS, "PYTORCH", \n'
    'FAST-FDN-STEREO-WEB, https://example.com/stereo_web/download, Browser build, '
    'ab' * 16 + ', WEB-ONLY, "", models/fast_foundation_stereo_l_web.onnx\n'
)

YAML = 'image_size:\n- 576\n- 960\nvalid_iters: 8\n'


def make_addon_zip(yaml_text=YAML, extra_onnx=False, web_onnx=False) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('configs/pipelines/interactive_stereo_default.conf', 'include x.conf\n')
        archive.writestr('configs/pipelines/models/fast_foundation_stereo_l.onnx', b'onnx-bytes')
        archive.writestr('configs/pipelines/models/fast_foundation_stereo_l.yaml', yaml_text)
        if extra_onnx:
            archive.writestr('configs/pipelines/models/other.onnx', b'x')
        if web_onnx:
            archive.writestr('configs/pipelines/models/fast_foundation_stereo_l_web.onnx', b'web-bytes')
            archive.writestr('configs/pipelines/models/fast_foundation_stereo_l_web.yaml', yaml_text)
    return buffer.getvalue()


def fake_downloader(payload: bytes):
    def download(url: str, dest: Path) -> str:
        dest.write_bytes(payload)
        return hashlib.md5(payload).hexdigest()

    return download


def test_parse_addon_rows_strips_whitespace_and_lowercases_md5():
    rows = stereo_models.parse_addon_rows(CSV)
    assert stereo_models.find_addon(rows, 'FAST-FDN-STEREO-WEB').url == 'https://example.com/stereo_web/download'
    stereo = stereo_models.find_addon(rows, 'FAST-FDN-STEREO')
    assert stereo == stereo_models.AddonSource(
        'FAST-FDN-STEREO',
        'https://example.com/stereo/download',
        '29d4cde2e33500e74844d07c5ab3dee0',
    )
    assert stereo_models.find_addon(rows, 'MISSING') is None


def test_resolve_addon_prefers_the_csv_row_and_falls_back_to_the_published_item(monkeypatch):
    class Response:
        def __init__(self, text):
            self.content = text.encode('utf-8')

        def raise_for_status(self):
            pass

    monkeypatch.setattr(stereo_models.requests, 'get', lambda *a, **k: Response(CSV))
    assert stereo_models.resolve_addon().url == 'https://example.com/stereo_web/download'

    monkeypatch.setattr(stereo_models.requests, 'get', lambda *a, **k: Response('A, https://x, d, 1, ALL-PLATFORMS, "", \n'))
    fallback = stereo_models.resolve_addon()
    assert fallback.url == stereo_models.DEFAULT_WEB_MODELS['448x768'][0]
    assert fallback.md5 == stereo_models.DEFAULT_WEB_MODELS['448x768'][1]

    monkeypatch.setenv(stereo_models.DEFAULT_WEB_MODEL_ENV, '576x960')
    assert stereo_models.resolve_addon().url == stereo_models.DEFAULT_WEB_MODELS['576x960'][0]

    def offline(*a, **k):
        raise stereo_models.requests.RequestException('offline')

    monkeypatch.setattr(stereo_models.requests, 'get', offline)
    assert stereo_models.resolve_addon().url == stereo_models.DEFAULT_WEB_MODELS['576x960'][0]
    with pytest.raises(stereo_models.ModelUnavailable):
        stereo_models.resolve_addon('SOMETHING-ELSE')


def test_parse_image_size_block_and_flow():
    assert stereo_models.parse_image_size(YAML) == (576, 960)
    assert stereo_models.parse_image_size('image_size: [320, 736]\n') == (320, 736)
    assert stereo_models.parse_image_size('valid_iters: 8\n') is None


def test_ensure_model_downloads_once_and_verifies_md5(tmp_path):
    payload = make_addon_zip()
    addon = stereo_models.AddonSource(
        'FAST-FDN-STEREO', 'https://example.com/stereo', hashlib.md5(payload).hexdigest()
    )
    calls = []

    def download(url, dest):
        calls.append(url)
        return fake_downloader(payload)(url, dest)

    model = stereo_models.ensure_model(addon, tmp_path, download)
    assert model.onnx_path.read_bytes() == b'onnx-bytes'
    assert (model.height, model.width) == (576, 960)
    assert model.md5 == addon.md5
    assert model.onnx_path.parent == tmp_path / addon.name / addon.md5

    again = stereo_models.ensure_model(addon, tmp_path, download)
    assert again.onnx_path == model.onnx_path
    assert calls == ['https://example.com/stereo']


def test_ensure_model_accepts_a_bare_onnx_without_sidecar(tmp_path):
    payload = b'raw-onnx-bytes'
    addon = stereo_models.AddonSource(
        'FAST-FDN-STEREO-WEB', 'https://example.com/web', hashlib.md5(payload).hexdigest()
    )
    model = stereo_models.ensure_model(addon, tmp_path, fake_downloader(payload))
    assert model.onnx_path.name == 'fast-fdn-stereo-web.onnx'
    assert model.onnx_path.read_bytes() == payload
    assert model.yaml_path is None
    assert (model.height, model.width) == (None, None)
    assert stereo_models.ensure_model(addon, tmp_path, fake_downloader(payload)).onnx_path == model.onnx_path


def test_ensure_model_rejects_md5_mismatch(tmp_path):
    payload = make_addon_zip()
    addon = stereo_models.AddonSource('FAST-FDN-STEREO', 'https://example.com/stereo', 'f' * 32)
    with pytest.raises(stereo_models.ModelUnavailable):
        stereo_models.ensure_model(addon, tmp_path, fake_downloader(payload))
    assert not (tmp_path / addon.name / addon.md5).exists()


def test_ensure_model_replaces_previous_md5(tmp_path):
    old_payload = make_addon_zip(yaml_text='image_size: [320, 736]\n')
    new_payload = make_addon_zip()
    old = stereo_models.AddonSource(
        'FAST-FDN-STEREO', 'https://example.com/old', hashlib.md5(old_payload).hexdigest()
    )
    new = stereo_models.AddonSource(
        'FAST-FDN-STEREO', 'https://example.com/new', hashlib.md5(new_payload).hexdigest()
    )
    stereo_models.ensure_model(old, tmp_path, fake_downloader(old_payload))
    model = stereo_models.ensure_model(new, tmp_path, fake_downloader(new_payload))
    assert (model.height, model.width) == (576, 960)
    assert not (tmp_path / old.name / old.md5).exists()


def test_extract_model_prefers_the_web_build(tmp_path):
    zip_path = tmp_path / 'addon.zip'
    zip_path.write_bytes(make_addon_zip(web_onnx=True))
    model = stereo_models.extract_model(zip_path, tmp_path / 'out')
    assert model.onnx_path.name == 'fast_foundation_stereo_l_web.onnx'
    assert model.onnx_path.read_bytes() == b'web-bytes'
    assert (model.height, model.width) == (576, 960)


def test_extract_model_requires_exactly_one_onnx(tmp_path):
    zip_path = tmp_path / 'addon.zip'
    zip_path.write_bytes(make_addon_zip(extra_onnx=True))
    with pytest.raises(stereo_models.ModelUnavailable):
        stereo_models.extract_model(zip_path, tmp_path / 'out')
