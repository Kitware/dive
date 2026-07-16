import csv
import io
import json
from typing import Dict, List, Optional, Tuple

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
    # Testing multi-polygon with different keys
    (
        {
            "0": {
                "id": 0,
                "attributes": {},
                "confidencePairs": [["fish", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [100, 100, 500, 500],
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "properties": {"key": ""},
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [[[100, 100], [200, 100], [200, 200], [100, 200]]],
                                    },
                                },
                                {
                                    "type": "Feature",
                                    "properties": {"key": "1"},
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [[[300, 300], [400, 300], [400, 400], [300, 400]]],
                                    },
                                },
                            ],
                        },
                    },
                ],
                "begin": 0,
                "end": 0,
            },
        },
        [
            "0,1.png,0,100,100,500,500,1.0,-1,fish,1.0,(poly) 100 100 200 100 200 200 100 200,(poly) 300 300 400 300 400 400 300 400",
            "",
        ],
        [],
    ),
    # Testing polygon with hole
    (
        {
            "0": {
                "id": 0,
                "attributes": {},
                "confidencePairs": [["object", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [100, 100, 500, 500],
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "properties": {"key": ""},
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [
                                            [[100, 100], [500, 100], [500, 500], [100, 500]],
                                            [[200, 200], [400, 200], [400, 400], [200, 400]],
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
                "begin": 0,
                "end": 0,
            },
        },
        [
            "0,1.png,0,100,100,500,500,1.0,-1,object,1.0,(poly) 100 100 500 100 500 500 100 500,(hole) 200 200 400 200 400 400 200 400",
            "",
        ],
        [],
    ),
    # Testing keyed polygon with hole
    (
        {
            "0": {
                "id": 0,
                "attributes": {},
                "confidencePairs": [["region", 1.0]],
                "features": [
                    {
                        "frame": 0,
                        "bounds": [0, 0, 1000, 1000],
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "properties": {"key": "2"},
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [
                                            [[0, 0], [1000, 0], [1000, 1000], [0, 1000]],
                                            [[100, 100], [200, 100], [200, 200], [100, 200]],
                                            [[300, 300], [400, 300], [400, 400], [300, 400]],
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
                "begin": 0,
                "end": 0,
            },
        },
        [
            "0,1.png,0,0,0,1000,1000,1.0,-1,region,1.0,(poly) 0 0 1000 0 1000 1000 0 1000,(hole) 100 100 200 100 200 200 100 200,(hole) 300 300 400 300 400 400 300 400",
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
            converted, _, warnings, fps, _datasetInfo = viame.load_csv_as_tracks_and_attributes(
                test['csv'], image_map
            )
            assert len(converted['tracks'].values()) > 0
        else:
            converted, _, warnings, fps, _datasetInfo = viame.load_csv_as_tracks_and_attributes(
                test['csv'], image_map
            )
            assert len(warnings) > 0


def _metadata_fields(csv_text: str) -> Optional[List[str]]:
    """Parse the exported CSV and return the entries of the ``# metadata`` row (sans the marker)."""
    for row in csv.reader(io.StringIO(csv_text)):
        if row and row[0] == '# metadata':
            return row[1:]
    return None


def _dataset_info_entry(fields: List[str]) -> Optional[dict]:
    entries = [f for f in fields if f.startswith('dataset_info: ')]
    if not entries:
        return None
    assert len(entries) == 1
    return json.loads(entries[0][len('dataset_info: ') :])


def test_dataset_info_on_metadata_line():
    """A populated datasetInfo is emitted as one nested JSON entry; numerics stay numeric."""
    datasetInfo = {
        "gfishsite_id": "2024TXN012",
        "cruise": 2403,
        "sta_lat": 26.8195,
        "year": 2024,
    }
    csv_text = ''.join(viame.export_tracks_as_csv([], header=True, datasetInfo=datasetInfo))
    fields = _metadata_fields(csv_text)
    assert fields is not None
    parsed = _dataset_info_entry(fields)
    # round-trips as a single key with numeric fields preserved and ids kept as strings
    assert parsed == datasetInfo
    assert isinstance(parsed['cruise'], int)
    assert isinstance(parsed['sta_lat'], float)
    assert isinstance(parsed['gfishsite_id'], str)


@pytest.mark.parametrize("datasetInfo", [None, {}])
def test_dataset_info_absent_when_empty(datasetInfo):
    """No dataset_info entry (no `dataset_info: {}` noise) when empty/absent."""
    csv_text = ''.join(viame.export_tracks_as_csv([], header=True, datasetInfo=datasetInfo))
    fields = _metadata_fields(csv_text)
    assert fields is not None
    assert not any(f.startswith('dataset_info') for f in fields)


def test_dataset_info_restored_on_parse_roundtrip():
    """datasetInfo exported on the # metadata line round-trips back as the 5th return value."""
    datasetInfo = {"gfishsite_id": "2024TXN012", "cruise": 2403}
    tracks = test_tuple[0][0]
    csv_text = ''.join(
        viame.export_tracks_as_csv(
            tracks.values(), filenames=filenames, header=True, datasetInfo=datasetInfo
        )
    )
    rows = csv_text.splitlines()
    annotations, _attributes, _warnings, _fps, parsed_info = (
        viame.load_csv_as_tracks_and_attributes(rows)
    )
    assert len(annotations['tracks']) == len(tracks)
    assert parsed_info == datasetInfo


def test_fps_parsed_case_insensitively_from_metadata():
    """Lowercase ``fps:`` (what DIVE and native VIAME write) is read back on import.

    Regression for an importer that only matched a capitalized ``Fps:`` and so silently
    dropped the frame rate from real VIAME CSVs.
    """
    csv_text = ''.join(viame.export_tracks_as_csv([], header=True, fps=23.976))
    assert '# metadata' in csv_text and 'fps: 23.976' in csv_text  # exported lowercase
    rows = csv_text.splitlines()
    _annotations, _attributes, _warnings, fps, _info = viame.load_csv_as_tracks_and_attributes(
        rows
    )
    assert float(fps) == 23.976


def test_notes_round_trip_through_csv_export():
    """Detection notes survive an export -> import cycle.

    Regression for an exporter that parsed ``(note)`` columns on import but never
    wrote them on export, so notes were silently dropped by every server-side CSV
    round trip while the desktop TypeScript serializer preserved them.
    """
    tracks = {
        "0": {
            "id": 0,
            "attributes": {},
            "confidencePairs": [["fish", 0.9]],
            "features": [
                {
                    "frame": 0,
                    "bounds": [884, 510, 1219, 737],
                    "notes": ["needs review", "occluded by kelp"],
                }
            ],
            "begin": 0,
            "end": 0,
        }
    }

    csv_text = ''.join(viame.export_tracks_as_csv(tracks.values(), filenames=filenames))
    assert '(note) needs review' in csv_text
    assert '(note) occluded by kelp' in csv_text

    rows = csv_text.splitlines()
    annotations, _attributes, _warnings, _fps, _info = viame.load_csv_as_tracks_and_attributes(
        rows
    )
    assert annotations['tracks']['0']['features'][0]['notes'] == [
        "needs review",
        "occluded by kelp",
    ]
