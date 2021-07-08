import json
from typing import Dict, List, Tuple

import pytest

from dive_server.serializers import viame

test_tuple: List[Tuple[list, dict, dict]] = [
    (
        [
            # all frames in a track must be the same type, so the type name for 0 will be ignored
            "0,1.png,0,884.66,510,1219.66,737.66,1,-1,ignored,0.98",
            "0,2.png,1,111,222,3333,444,1,-1,typestring,0.55",
            "1,1.png,0,747,457,1039,633,1,-1,type2,1",
            # Keypoint testing with HeadTails Line
            "2,3.png,2,10,50,20,35,1,-1,type3,0.765,(kp) head 22.4534 45.6564,(kp) tail 55.232 22.3445",
            # Keypoint without HeadTails Line
            "2,4.png,3,10,50,20,35,1,-1,type3,0.765,(kp) head 22.4534 45.6564",
            # Multiple ConfidencePair Test
            "3,4.png,4,10,10,20,20,1,-1,type1,0.89,type2,0.65",
            # Polygon Test with floats
            "4,5.png,5,10,10,20,20,1,-1,type1,0.89,type2,0.65,(poly) 1 2.34 3 4 5 6 7 8.08 9 10",
            # Track and Frame Attr testing
            "5,6.png,6,10,10,20,20,1,-1,type1,0.89,(atr) attrNAME spaced attr name,(trk-atr) booleanAttr true",
            # Multiple ConfidencePair Sorting Test
            "6,4.png,4,10,10,20,20,1,-1,type2,0.65,type1,0.89,type3,0.24",
        ],
        {
            "0": {
                "trackId": 0,
                "attributes": {},
                "confidencePairs": [["typestring", 0.55]],
                "features": [
                    {
                        "frame": 0,
                        # NOTICE numbers that were rounded!
                        "bounds": [885, 510, 1220, 738],
                        "keyframe": True,
                        "interpolate": False,
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                        "keyframe": True,
                        "interpolate": False,
                    },
                ],
                "begin": 0,
                "end": 1,
            },
            "1": {
                "trackId": 1,
                "attributes": {},
                "confidencePairs": [["type2", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [747, 457, 1039, 633],
                        "keyframe": True,
                        "interpolate": False,
                    }
                ],
                "begin": 0,
                "end": 0,
            },
            "2": {
                "trackId": 2,
                "attributes": {},
                "confidencePairs": [["type3", 0.765]],
                "features": [
                    {
                        "frame": 2,
                        "bounds": [10, 50, 20, 35],
                        "keyframe": True,
                        "interpolate": False,
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "properties": {"key": "head"},
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [22.4534, 45.6564],
                                    },
                                },
                                {
                                    "type": "Feature",
                                    "properties": {"key": "tail"},
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [55.232, 22.3445],
                                    },
                                },
                                {
                                    "type": "Feature",
                                    "properties": {"key": "HeadTails"},
                                    "geometry": {
                                        "coordinates": [
                                            [22.4534, 45.6564],
                                            [55.232, 22.3445],
                                        ],
                                        "type": "LineString",
                                    },
                                },
                            ],
                        },
                    },
                    {
                        "frame": 3,
                        "bounds": [10, 50, 20, 35],
                        "keyframe": True,
                        "interpolate": False,
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "properties": {"key": "head"},
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [22.4534, 45.6564],
                                    },
                                },
                            ],
                        },
                    },
                ],
                "begin": 2,
                "end": 3,
            },
            "3": {
                "trackId": 3,
                "attributes": {},
                "confidencePairs": [["type1", 0.89], ["type2", 0.65]],
                "features": [
                    {
                        "frame": 4,
                        "bounds": [10, 10, 20, 20],
                        "keyframe": True,
                        "interpolate": False,
                    },
                ],
                "begin": 4,
                "end": 4,
            },
            "4": {
                "trackId": 4,
                "attributes": {},
                "confidencePairs": [["type1", 0.89], ["type2", 0.65]],
                "features": [
                    {
                        "frame": 5,
                        "bounds": [10, 10, 20, 20],
                        "keyframe": True,
                        "interpolate": False,
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "properties": {"key": ""},
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [
                                            [
                                                [1.0, 2.34],
                                                [3.0, 4.0],
                                                [5.0, 6.0],
                                                [7.0, 8.08],
                                                [9.0, 10.0],
                                            ]
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
                "begin": 5,
                "end": 5,
            },
            "5": {
                "trackId": 5,
                "attributes": {"booleanAttr": True},
                "confidencePairs": [["type1", 0.89]],
                "features": [
                    {
                        "frame": 6,
                        "bounds": [10, 10, 20, 20],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {"attrNAME": "spaced attr name"},
                    },
                ],
                "begin": 6,
                "end": 6,
            },
            "6": {
                "trackId": 6,
                "attributes": {},
                "confidencePairs": [["type1", 0.89], ["type2", 0.65], ["type3", 0.24]],
                "features": [
                    {
                        "frame": 4,
                        "bounds": [10, 10, 20, 20],
                        "keyframe": True,
                        "interpolate": False,
                    },
                ],
                "begin": 4,
                "end": 4,
            },
        },
        {
            'detection_attrNAME': {
                "belongs": "detection",
                "datatype": "text",
                "key": "detection_attrNAME",
                "name": "attrNAME",
            },
            'track_booleanAttr': {
                "belongs": "track",
                "datatype": "boolean",
                "key": "track_booleanAttr",
                "name": "booleanAttr",
            },
        },
    ),
    (
        [
            # test that variable length is handled properly
            # length == 11, valid
            "0,1.png,0,884,510,1219,737,1,-1,typestring,1,",
            # length == 12, note ignored
            "0,2.png,1,111,222,3333,444,1,-1,typestring,1,(note) note",
            # Length == 13, both notes ignored
            "0,3.png,2,747,457,1039,633,1,-1,typestring,1,(note) note,(note) note2",
        ],
        {
            "0": {
                "trackId": 0,
                "attributes": {},
                "confidencePairs": [["typestring", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [884, 510, 1219, 737],
                        "keyframe": True,
                        "interpolate": False,
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                        "keyframe": True,
                        "interpolate": False,
                    },
                    {
                        "frame": 2,
                        "bounds": [747, 457, 1039, 633],
                        "keyframe": True,
                        "interpolate": False,
                    },
                ],
                "begin": 0,
                "end": 2,
            },
        },
        {},
    ),
    (
        [
            # testing attributes interpretation
            "0,1.png,0,884.66,510,1219.66,737.66,1,-1,typestring,1,(atr) DetectionNumber 2.002,(atr) DetectionPredefinedValue value1",
            "0,2.png,1,111,222,3333,444,1,-1,typestring,1,(trk-atr) booleanAttr true,(atr) DetectionPredefinedValue value2",
            "0,3.png,2,747,457,1039,633,1,-1,typestring,1,(trk-atr) booleanAttr true,(atr) DetectionPredefinedValue value3",
            "0,3.png,3,884.66,510,1219.66,737.66,1,-1,typestring,1,(trk-atr) booleanAttr true,(atr) DetectionPredefinedValue value1",
            "0,4.png,4,111,222,3333,444,1,-1,typestring,1,(atr) DetectionPredefinedValue value2",
            "0,5.png,5,747,457,1039,633,1,-1,typestring,1,(atr) DetectionPredefinedValue value3",
            "1,1.png,0,884.66,510,1219.66,737.66,1,-1,typestring,1,(atr) DetectionNumber 2.002,(atr) DetectionPredefinedValue value1",
            "1,2.png,1,111,222,3333,444,1,-1,typestring,1,(trk-atr) booleanAttr true,(atr) DetectionPredefinedValue value2",
            "1,3.png,2,747,457,1039,633,1,-1,typestring,1,(trk-atr) booleanAttr true,(atr) DetectionPredefinedValue value3",
            "1,3.png,3,884.66,510,1219.66,737.66,1,-1,typestring,1,(trk-atr) booleanAttr true,(atr) DetectionPredefinedValue value1",
            "1,4.png,4,111,222,3333,444,1,-1,typestring,1,(atr) DetectionPredefinedValue value2",
            "1,5.png,5,747,457,1039,633,1,-1,typestring,1,(atr) DetectionPredefinedValue value3",
        ],
        {
            "0": {
                "trackId": 0,
                "attributes": {"booleanAttr": True},
                "confidencePairs": [["typestring", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [885, 510, 1220, 738],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value1",
                            "DetectionNumber": 2.002,
                        },
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value2",
                        },
                    },
                    {
                        "frame": 2,
                        "bounds": [747, 457, 1039, 633],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value3",
                        },
                    },
                    {
                        "frame": 3,
                        "bounds": [885, 510, 1220, 738],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value1",
                        },
                    },
                    {
                        "frame": 4,
                        "bounds": [111, 222, 3333, 444],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value2",
                        },
                    },
                    {
                        "frame": 5,
                        "bounds": [747, 457, 1039, 633],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value3",
                        },
                    },
                ],
                "begin": 0,
                "end": 5,
            },
            "1": {
                "trackId": 1,
                "attributes": {"booleanAttr": True},
                "confidencePairs": [["typestring", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [885, 510, 1220, 738],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value1",
                            "DetectionNumber": 2.002,
                        },
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value2",
                        },
                    },
                    {
                        "frame": 2,
                        "bounds": [747, 457, 1039, 633],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value3",
                        },
                    },
                    {
                        "frame": 3,
                        "bounds": [885, 510, 1220, 738],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value1",
                        },
                    },
                    {
                        "frame": 4,
                        "bounds": [111, 222, 3333, 444],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value2",
                        },
                    },
                    {
                        "frame": 5,
                        "bounds": [747, 457, 1039, 633],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {
                            "DetectionPredefinedValue": "value3",
                        },
                    },
                ],
                "begin": 0,
                "end": 5,
            },
        },
        {
            'detection_DetectionNumber': {
                "belongs": "detection",
                "datatype": "number",
                "key": "detection_DetectionNumber",
                "name": "DetectionNumber",
            },
            'detection_DetectionPredefinedValue': {
                "belongs": "detection",
                "datatype": "text",
                "key": "detection_DetectionPredefinedValue",
                "name": "DetectionPredefinedValue",
                "values": ["value1", "value2", "value3"],
            },
            'track_booleanAttr': {
                "belongs": "track",
                "datatype": "boolean",
                "key": "track_booleanAttr",
                "name": "booleanAttr",
            },
        },
    ),
    (
        [
            # test that missing track object types is handled properly
            "0,1.png,0,884,510,1219,737,1.0,-1,",
            "0,2.png,1,111,222,3333,444,1.0,-1,,",
            "1,1.png,0,747,457,1039,633,0.8,-1",
        ],
        {
            "0": {
                "trackId": 0,
                "attributes": {},
                "confidencePairs": [["unknown", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [884, 510, 1219, 737],
                        "keyframe": True,
                        "interpolate": False,
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                        "keyframe": True,
                        "interpolate": False,
                    },
                ],
                "begin": 0,
                "end": 1,
            },
            "1": {
                "trackId": 1,
                "attributes": {},
                "confidencePairs": [["unknown", 0.8]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [747, 457, 1039, 633],
                        "keyframe": True,
                        "interpolate": False,
                    }
                ],
                "begin": 0,
                "end": 0,
            },
        },
        {},
    ),
]


@pytest.mark.parametrize("input,expected_tracks,expected_attributes", test_tuple)
def test_read_viame_csv(
    input: List[str],
    expected_tracks: Dict[str, dict],
    expected_attributes: Dict[str, dict],
):
    (tracks, attributes) = viame.load_csv_as_tracks_and_attributes(input)
    assert json.dumps(tracks, sort_keys=True) == json.dumps(
        expected_tracks, sort_keys=True
    )
    assert json.dumps(attributes, sort_keys=True) == json.dumps(
        expected_attributes, sort_keys=True
    )
