import json
from typing import Dict

import pytest

from dive_utils.serializers.viame import export_tracks_as_csv, load_csv_as_tracks_and_attributes

with open('../testutils/attributes.spec.json', 'r') as fp:
    test_tuple = json.load(fp)


@pytest.mark.parametrize("input,expected_tracks,expected_attributes", test_tuple)
def test_read_viame_attributes(
    input: Dict[str, dict],
    expected_tracks: Dict[str, dict],
    expected_attributes: Dict[str, dict],
):
    rows = []
    text = ''
    for _i, line in enumerate(
        export_tracks_as_csv(
            input.values(),
        )
    ):
        print(line)
        rows.append(line)
        text = text + line
        print()
    converted, meta = load_csv_as_tracks_and_attributes(text.split('\n'))
    assert json.dumps(converted['tracks'], sort_keys=True) == json.dumps(
        expected_tracks, sort_keys=True
    )
    assert json.dumps(meta['attributes'], sort_keys=True) == json.dumps(
        expected_attributes, sort_keys=True
    )
