import json
import re
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


def test_centerline_order_and_subpixel_coordinates():
    row = '1,img.png,0,0,0,100,100,1,-1,fish,1,(kp) tail 90 10,(kp) spine_010 60.123456789 40,(kp) head 10 10,(kp) spine_002 40 30,(kp) eye 12 11'
    features, *_ = viame._parse_row(row.split(','))
    line = next(
        f for f in features['geometry']['features'] if f['geometry']['type'] == 'LineString'
    )
    assert line['geometry']['coordinates'] == [[10, 10], [40, 30], [60.123456789, 40], [90, 10]]
    assert any(f['properties']['key'] == 'eye' for f in features['geometry']['features'])


MISSING_IMAGE_ROWS = [
    '0,1.png,0,10,10,20,20,1,-1,fish,0.9',
    '0,2.png,1,11,11,21,21,1,-1,fish,0.9',
    '0,3.png,2,12,12,22,22,1,-1,fish,0.9',
    '1,2.png,1,30,30,40,40,1,-1,crab,0.8',
]


def test_image_missing_mid_sequence_skips_its_detections_with_warning():
    image_map = {'1': 0, '3': 1}
    converted, _, warnings, _, _ = viame.load_csv_as_tracks_and_attributes(
        MISSING_IMAGE_ROWS, image_map
    )
    tracks = converted['tracks']
    assert list(tracks) == ['0']
    assert [f['frame'] for f in tracks['0']['features']] == [0, 1]
    assert (tracks['0']['begin'], tracks['0']['end']) == (0, 1)
    assert any('2.png' in w and '2 detection(s)' in w for w in warnings)


def test_no_images_matched_keeps_csv_frames_with_warning():
    image_map = {'a': 0, 'b': 1, 'c': 2}
    converted, _, warnings, _, _ = viame.load_csv_as_tracks_and_attributes(
        MISSING_IMAGE_ROWS, image_map
    )
    assert [f['frame'] for f in converted['tracks']['0']['features']] == [0, 1, 2]
    assert any(w.startswith('None of the 3 image(s)') and '3.png' in w for w in warnings)


def test_blank_image_column_does_not_warn():
    rows = [re.sub(r'\d\.png', '', row) for row in MISSING_IMAGE_ROWS]
    _, _, warnings, _, _ = viame.load_csv_as_tracks_and_attributes(rows, {'a': 0})
    assert warnings == []
