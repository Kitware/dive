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
    converted, attributes, warnings, fps, _datasetInfo = viame.load_csv_as_tracks_and_attributes(
        input
    )
    assert json.dumps(converted['tracks'], sort_keys=True) == json.dumps(
        expected_tracks, sort_keys=True
    )
    assert json.dumps(attributes, sort_keys=True) == json.dumps(expected_attributes, sort_keys=True)


@pytest.mark.parametrize("column_length", [0, -1, -2.5, 12.5])
@pytest.mark.parametrize("attribute_length", [None, 0, -1, -2.5, 7.5])
def test_import_detection_length(column_length, attribute_length):
    row = f"0,1.png,0,10,10,20,20,1,{column_length},fish,0.9,(atr) other 3"
    if attribute_length is not None:
        row += f",(atr) length {attribute_length}"
    converted, attributes, *_ = viame.load_csv_as_tracks_and_attributes([row])
    feature = converted['tracks']['0']['features'][0]
    expected = (
        attribute_length if attribute_length is not None and attribute_length > 0 else column_length
    )
    assert feature['attributes']['other'] == 3
    if expected > 0:
        assert feature['attributes']['length'] == expected
        assert feature['fishLength'] == expected
        assert 'detection_length' in attributes
    else:
        assert 'length' not in feature['attributes']
        assert 'fishLength' not in feature
        assert 'detection_length' not in attributes
