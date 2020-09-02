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
            "0,2.png,1,2,2,4,4,0.9,-1,baz,0.1,foo,0.2,bar,0.9",
            "0,3.png,2,3,3,6,6,0.9,-1,baz,0.1,foo,0.2,bar,0.9",
            "0,4.png,3,4,4,8,8,0.9,-1,baz,0.1,foo,0.2,bar,0.9",
        ],
    ),
]


@pytest.mark.parametrize("input,expected", test_tuple)
def test_write_csv(input: Dict[str, dict], expected: List[str]):
    for i, line in enumerate(viame.export_tracks_as_csv(input, filenames=filenames)):
        assert line.strip(' ').rstrip() == expected[i]
