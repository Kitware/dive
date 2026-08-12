from pathlib import Path
from unittest.mock import patch

import pytest

from dive_tasks.upgrade_pipelines import (
    _addon_zip_path_for_url,
    download_google_drive_zip,
    is_google_drive_addon_url,
)


@pytest.mark.parametrize(
    'url,expected',
    [
        ('https://drive.google.com/file/d/abc123XYZ/view?usp=sharing', True),
        ('https://www.drive.google.com/open?id=abc123', True),
        ('https://drive.google.com/uc?id=abc123&export=download', True),
        ('https://docs.google.com/uc?id=abc123&export=download', True),
        ('https://viame.kitware.com/api/v1/item/627b145487bad2e19a4c4697/download', False),
        ('https://example.com/addon.zip', False),
    ],
)
def test_is_google_drive_addon_url(url: str, expected: bool):
    assert is_google_drive_addon_url(url) is expected


def test_addon_zip_path_uses_gdrive_file_id(tmp_path: Path):
    url = 'https://drive.google.com/file/d/abc123XYZ/view?usp=sharing'
    assert _addon_zip_path_for_url(url, tmp_path) == tmp_path / 'gdrive_abc123XYZ.zip'


def test_addon_zip_path_normalizes_www(tmp_path: Path):
    url = 'https://www.drive.google.com/open?id=abc123XYZ'
    assert _addon_zip_path_for_url(url, tmp_path) == tmp_path / 'gdrive_abc123XYZ.zip'


def test_addon_zip_path_keeps_http_path_naming(tmp_path: Path):
    url = 'https://viame.kitware.com/api/v1/item/627b145487bad2e19a4c4697/download'
    expected = tmp_path / '_api_v1_item_627b145487bad2e19a4c4697_download.zip'
    assert _addon_zip_path_for_url(url, tmp_path) == expected


def test_download_google_drive_zip_uses_gdown(tmp_path: Path):
    dest = tmp_path / 'addon.zip'
    url = 'https://www.drive.google.com/file/d/abc123XYZ/view?usp=sharing'
    with patch('dive_tasks.upgrade_pipelines.gdown.download') as mock_download:
        download_google_drive_zip(url, dest)
    mock_download.assert_called_once_with(
        url='https://drive.google.com/file/d/abc123XYZ/view?usp=sharing',
        output=str(dest),
        quiet=True,
    )
