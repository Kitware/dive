import json
from typing import Dict, List

import pytest

from viame_server.serializers import viame

test_tuple = [
    (
        [
            # all frames in a track must be of the same type, so the type name for 0 will be ignored
            "0,1.png,0,884,510,1219,737,1,-1,ignored,1",
            "0,2.png,1,111,222,3333,444,1,-1,typestring,1",
            "1,1.png,0,747,457,1039,633,1,-1,type2,1",
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
    ),
    (
        [
            # test that variable length is handled properly
            # length == 11, valid
            "0,1.png,0,884,510,1219,737,1,-1,typestring,1",
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
    ),
]


@pytest.mark.parametrize("input,expected", test_tuple)
def test_read_csv(input: List[str], expected: Dict[str, dict]):
    out_json = viame.load_csv_as_tracks(input)
    assert json.dumps(out_json, sort_keys=True) == json.dumps(expected, sort_keys=True)
