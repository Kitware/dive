import csv
import io
import os
from typing import Dict, List

import pytest

from viame_server.serializers import models, viame

# Test cases can use this by staying under frame 100
filenames = [f"{str(i)}.png" for i in range(1, 100)]

test_tuple = [
    (
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
        },
        [
            "0,1.png,0,884,510,1219,737,1.0,-1,typestring,1.0",
            "0,2.png,1,111,222,3333,444,1.0,-1,typestring,1.0",
            "1,1.png,0,747,457,1039,633,1.0,-1,type2,1.0",
        ],
    ),
    (
        {
            "1": {
                "begin": 1,
                "end": 3,
                "trackId": 0,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [2, 2, 4, 4],
                        "interpolate": True,
                        "keyframe": True,
                    },
                    {
                        "frame": 3,
                        "bounds": [4, 4, 8, 8],
                        "interpolate": True,
                        "keyframe": True,
                    },
                ],
                "confidencePairs": [["foo", 0.2], ["bar", 0.9], ["baz", 0.1]],
            }
        },
        [
            "0,2.png,1,2,2,4,4,0.9,-1,bar,0.9,foo,0.2,baz,0.1",
            "0,3.png,2,3,3,6,6,0.9,-1,bar,0.9,foo,0.2,baz,0.1",
            "0,4.png,3,4,4,8,8,0.9,-1,bar,0.9,foo,0.2,baz,0.1",
        ],
    ),
    # Testing geoJSON Features for Keypoints (head/tails) and Polygons
    (
        {
            "1": {
                "begin": 1,
                "end": 3,
                "trackId": 0,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [2, 2, 4, 4],
                        "interpolate": True,
                        "keyframe": True,
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
                        "keyframe": True,
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
        ],
    ),
    (
        {
            "0": {
                "trackId": 0,
                "attributes": {
                    "trackATTR": "TestTrack ATTR With Space",
                },
                "confidencePairs": [["typestring", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [884, 510, 1219, 737],
                        "keyframe": True,
                        "interpolate": False,
                        "attributes": {"detectionAttr": "frame 0 attr"},
                    },
                    {
                        "frame": 1,
                        "bounds": [111, 222, 3333, 444],
                        "keyframe": True,
                        "interpolate": False,
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
        ],
    ),
]


@pytest.mark.parametrize("input,expected", test_tuple)
def test_write_csv(input: Dict[str, dict], expected: List[str]):
    for i, line in enumerate(
        viame.export_tracks_as_csv(input, filenames=filenames, header=False)
    ):
        assert line.strip(' ').rstrip() == expected[i]
