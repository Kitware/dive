import re
from typing import Dict, List, Tuple

import pytest

from dive_utils.serializers import viame

# Test cases can use this by staying under frame 100
filenames = [f"{str(i)}.png" for i in range(1, 100)]

test_tuple: List[Tuple[dict, list, list]] = [
    (
        {
            "0": {
                "id": 0,
                "attributes": {},
                "confidencePairs": [["typestring", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [884, 510, 1219, 737],
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                    },
                ],
                "begin": 0,
                "end": 1,
            },
            "1": {
                "id": 1,
                "attributes": {},
                "confidencePairs": [["type2", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [747, 457, 1039, 633],
                    }
                ],
                "begin": 0,
                "end": 0,
            },
        },
        [
            "0,1.png,0,884,510,1219,737,1.0,-1,typestring,1.0",
            "0,2.png,1,111,222,3333,444,1.0,-1,typestring,1.0",
            "1,1.png,0,747,457,1039,633,1.0,-1,type2,1.0",
            "",
        ],
        [],
    ),
    (
        {
            "1": {
                "begin": 1,
                "end": 3,
                "id": 0,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [2, 2, 4, 4],
                        "interpolate": True,
                    },
                    {
                        "frame": 3,
                        "bounds": [4, 4, 8, 8],
                        "interpolate": True,
                    },
                ],
                "confidencePairs": [["foo", 0.2], ["bar", 0.9], ["baz", 0.1]],
            }
        },
        [
            "0,2.png,1,2,2,4,4,0.9,-1,bar,0.9,foo,0.2,baz,0.1",
            "0,3.png,2,3,3,6,6,0.9,-1,bar,0.9,foo,0.2,baz,0.1",
            "0,4.png,3,4,4,8,8,0.9,-1,bar,0.9,foo,0.2,baz,0.1",
            "",
        ],
        [],
    ),
    # Testing geoJSON Features for Keypoints (head/tails) and Polygons
    (
        {
            "1": {
                "begin": 1,
                "end": 3,
                "id": 0,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [2, 2, 4, 4],
                        "interpolate": True,
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
                        "bounds": [4, 4, 8, 8],
                        "interpolate": True,
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
                "confidencePairs": [["foo", 0.2], ["bar", 0.9], ["baz", 0.1]],
            }
        },
        [
            "0,2.png,1,2,2,4,4,0.9,-1,bar,0.9,foo,0.2,baz,0.1,(kp) head 22 46,(kp) tail 55 22",
            "0,3.png,2,3,3,6,6,0.9,-1,bar,0.9,foo,0.2,baz,0.1",
            "0,4.png,3,4,4,8,8,0.9,-1,bar,0.9,foo,0.2,baz,0.1,(poly) 1 2 3 4 5 6 7 8 9 10",
            "",
        ],
        [],
    ),
    (
        {
            "0": {
                "id": 0,
                "attributes": {
                    "trackATTR": "TestTrack ATTR With Space",
                },
                "confidencePairs": [["typestring", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [884, 510, 1219, 737],
                        "attributes": {"detectionAttr": "frame 0 attr"},
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                        "attributes": {"detectionAttr": "frame 1 attr"},
                    },
                ],
                "begin": 0,
                "end": 1,
            },
        },
        [
            "0,1.png,0,884,510,1219,737,1.0,-1,typestring,1.0,(atr) detectionAttr frame 0 attr,(trk-atr) trackATTR TestTrack ATTR With Space",
            "0,2.png,1,111,222,3333,444,1.0,-1,typestring,1.0,(atr) detectionAttr frame 1 attr,(trk-atr) trackATTR TestTrack ATTR With Space",
            "",
        ],
        [],
    ),
    # Testing type filter
    (
        {
            "0": {
                "id": 0,
                "attributes": {},
                "confidencePairs": [["typestring", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [884, 510, 1219, 737],
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                    },
                ],
                "begin": 0,
                "end": 1,
            },
            "1": {
                "id": 1,
                "attributes": {},
                "confidencePairs": [["type2", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [747, 457, 1039, 633],
                    }
                ],
                "begin": 0,
                "end": 0,
            },
        },
        [
            "1,1.png,0,747,457,1039,633,1.0,-1,type2,1.0",
            "",
        ],
        ['type2'],
    ),
    (
        {
            "0": {
                "id": 0,
                "attributes": {},
                "confidencePairs": [["typestring", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [884, 510, 1219, 737],
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                    },
                ],
                "begin": 0,
                "end": 1,
            },
            "1": {
                "id": 1,
                "attributes": {},
                "confidencePairs": [["type2", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [747, 457, 1039, 633],
                    }
                ],
                "begin": 0,
                "end": 0,
            },
        },
        [
            "0,1.png,0,884,510,1219,737,1.0,-1,typestring,1.0",
            "0,2.png,1,111,222,3333,444,1.0,-1,typestring,1.0",
            "",
        ],
        ['typestring', 'type3', 'type4'],
    ),
]

image_filename_tests = [
    {
        'warning': False,
        'csv': [
            '0,       ,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
            '1,2.png,0,111,222,3333,444,1,-1,typestring,0.55',
        ],
    },
    {
        'warning': True,
        'csv': [
            '0,1.png,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
            '1,invalid,0,111,222,3333,444,1,-1,typestring,0.55',
            '2,2.png,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
        ],
    },
    {
        'warning': False,
        'csv': [
            '0,invalid1,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
            '',
            '1,invalid2,0,111,222,3333,444,1,-1,typestring,0.55',
        ],
    },
    {
        'warning': False,
        'csv': [
            '0,       ,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
            '',
            '1,,0,111,222,3333,444,1,-1,typestring,0.55',
        ],
    },
    {
        'warning': False,
        'csv': [
            '0,1.png,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
            '',
            '1,1.png,0,111,222,3333,444,1,-1,typestring,0.55',
        ],
    },
    {
        'warning': True,
        'csv': [
            '99,1.png,0,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
            '99,3.png,1,111,222,3333,444,1,-1,typestring,0.55',
        ],
    },
    {
        'warning': False,
        'csv': [
            '99,unknown1,2,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
            '99,unknown2,2,111,222,3333,444,1,-1,typestring,0.55',
        ],
    },
]


@pytest.mark.parametrize("input,expected,typeFilter", test_tuple)
def test_write_viame_csv(input: Dict[str, dict], expected: List[str], typeFilter: List[str]):
    for i, line in enumerate(
        viame.export_tracks_as_csv(
            input.values(), filenames=filenames, header=False, typeFilter=set(typeFilter)
        )
    ):
        assert line.strip(' ').rstrip() == expected[i]


def test_empty_header():
    for chunk in viame.export_tracks_as_csv([], header=True):
        lines = chunk.splitlines()
        for line in lines:
            assert line.startswith('#')
        assert len(lines) == 2


def test_image_filenames():
    image_map = {'1': 0, '2': 1, '3': 2}
    for test in image_filename_tests:
        if not test['warning']:
            converted, _, warnings, fps = viame.load_csv_as_tracks_and_attributes(test['csv'], image_map)
            assert len(converted['tracks'].values()) > 0
        else:
            converted, _, warnings, fps = viame.load_csv_as_tracks_and_attributes(test['csv'], image_map)
            assert len(warnings) > 0

