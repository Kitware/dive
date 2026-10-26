"""Nested-zip rejection during extract_zip (case-insensitive)."""

from pathlib import Path
import zipfile

import pytest

from dive_tasks.convert_images import raise_if_nested_zip


@pytest.mark.parametrize(
    'member',
    [
        'sidecar.zip',
        'sidecar.ZIP',
        'sidecar.Zip',
        'subdir/inner.ZIP',
    ],
)
def test_raise_if_nested_zip_rejects_case_variants(member: str):
    with pytest.raises(Exception, match='Nested Zip Files are invalid'):
        raise_if_nested_zip(member)


@pytest.mark.parametrize(
    'member',
    [
        'frame001.png',
        'tracks.csv',
        'notzip.zip.bak',
        'archive.zipped',
    ],
)
def test_raise_if_nested_zip_allows_non_zip_members(member: str):
    raise_if_nested_zip(member)


def test_uppercase_nested_zip_in_archive_is_rejected(tmp_path: Path):
    """Mirror the Eureka failure: media plus a nested ``.ZIP`` member."""
    outer = tmp_path / 'Eureka.zip'
    with zipfile.ZipFile(outer, 'w') as zf:
        zf.writestr('frame001.png', b'png')
        zf.writestr('sidecar.ZIP', b'PK\x03\x04nested')

    with zipfile.ZipFile(outer) as zf:
        with pytest.raises(Exception, match='Nested Zip Files are invalid'):
            for name in zf.namelist():
                raise_if_nested_zip(name)
