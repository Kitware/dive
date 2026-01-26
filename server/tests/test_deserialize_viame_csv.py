import json
from typing import Dict, List

import pytest

from dive_utils.serializers import viame

with open('../testutils/viame.spec.json', 'r') as fp:
    test_tuple = json.load(fp)


@pytest.mark.parametrize("input,expected_tracks,expected_attributes", test_tuple)
def test_read_viame_csv(
    input: List[str],
    expected_tracks: Dict[str, dict],
    expected_attributes: Dict[str, dict],
):
    (converted, attributes, warnings, fps) = viame.load_csv_as_tracks_and_attributes(input)
    actual_json = json.dumps(converted['tracks'], sort_keys=True)
    expected_json = json.dumps(expected_tracks, sort_keys=True)
    if actual_json != expected_json:
        print(f"\n=== ACTUAL ===\n{actual_json}")
        print(f"\n=== EXPECTED ===\n{expected_json}")
    assert actual_json == expected_json
    assert json.dumps(attributes, sort_keys=True) == json.dumps(expected_attributes, sort_keys=True)
