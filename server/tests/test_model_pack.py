"""Model archives retain all pipeline-relative files across supported layouts."""

from io import BytesIO
import json
from pathlib import Path
import stat
from zipfile import ZipFile, ZipInfo

import pytest

from dive_utils.model_pack import extract_model_pack, model_pack_paths

CASES = json.loads((Path(__file__).parents[2] / 'testutils/model-pack-layouts.json').read_text())


@pytest.mark.parametrize('case', CASES, ids=lambda case: case['name'])
def test_layouts(case, tmp_path):
    source = BytesIO()
    with ZipFile(source, 'w') as archive:
        for name in case['files']:
            archive.writestr(name, f'contents of {name}')
    extract_model_pack(source, tmp_path)
    assert sorted(
        str(p.relative_to(tmp_path)) for p in tmp_path.rglob('*') if p.is_file()
    ) == sorted(case['expected'])
    for original, relative in model_pack_paths(case['files']).items():
        assert (tmp_path / relative).read_text() == f'contents of {original}'


@pytest.mark.parametrize(
    'names',
    [
        ['../escape.pipe'],
        ['/absolute.pipe'],
        ['C:/escape.pipe'],
        ['pack/../../escape.pipe'],
        ['pack\\..\\escape.pipe'],
        ['custom.pipe', 'CUSTOM.pipe'],
        ['custom.pipe', 'custom.pipe'],
        ['custom.pipe', 'models', 'models/weights.pt'],
        ['weights.pt'],
    ],
)
def test_reject_invalid_layout(names):
    with pytest.raises(ValueError):
        model_pack_paths(names)


def test_reject_links(tmp_path):
    source = BytesIO()
    with ZipFile(source, 'w') as archive:
        link = ZipInfo('model.pipe')
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, '/etc/passwd')
    with pytest.raises(ValueError, match='symbolic links'):
        extract_model_pack(source, tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_reject_duplicate_entries_before_extraction(tmp_path):
    source = BytesIO()
    with ZipFile(source, 'w') as archive:
        archive.writestr('detector.pipe', 'first')
        with pytest.warns(UserWarning):
            archive.writestr('detector.pipe', 'second')
    with pytest.raises(ValueError, match='Duplicate'):
        extract_model_pack(source, tmp_path)
    assert list(tmp_path.iterdir()) == []
