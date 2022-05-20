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
    (converted, attributes) = viame.load_csv_as_tracks_and_attributes(input)
    assert json.dumps(converted['tracks'], sort_keys=True) == json.dumps(
        expected_tracks, sort_keys=True
    )
    assert json.dumps(attributes, sort_keys=True) == json.dumps(expected_attributes, sort_keys=True)
