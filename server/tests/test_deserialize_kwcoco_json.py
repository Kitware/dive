import json
from pathlib import Path
from typing import Dict, List, Tuple

import pytest

from dive_utils.serializers import kwcoco

KWCOCO_PROFILE = json.loads(
    (Path(__file__).parents[2] / 'testutils/kwcoco/import-profile.json').read_text()
)

test_tuple: List[Tuple[dict, dict, dict]] = [
    (
        # test if coco native is handled properly
        {
            "categories": [
                {
                    "id": 1,
                    "name": "astronaut",
                    "supercategory": "human",
                    "keypoints": ["head", "tail"],
                },
                {
                    "id": 2,
                    "name": "rocket",
                    "supercategory": "object",
                    "keypoints": ["head", "tail"],
                },
                {"id": 3, "name": "helmet", "supercategory": "object"},
            ],
            "images": [
                {"id": 1, "file_name": "astro.png"},
                {"id": 2, "file_name": "carl.jpg"},
            ],
            "annotations": [
                {
                    "id": 1,
                    "image_id": 1,
                    "category_id": 1,
                    "bbox": [10, 10, 360, 490],
                    "keypoints": [247, 101, 2, 202, 100, 2],
                    "segmentation": [
                        [
                            40,
                            509,
                            26,
                            486,
                            20,
                            419,
                            28,
                            334,
                            51,
                            266,
                            85,
                            229,
                            102,
                            216,
                            118,
                            197,
                            125,
                            176,
                        ]
                    ],
                },
                {"id": 2, "image_id": 1, "category_id": 2, "bbox": [350, 5, 130, 290]},
                {
                    "id": 3,
                    "image_id": 1,
                    "category_id": 3,
                    "keypoints": [326, 369, 500, 500],
                    "bbox": [326, 369, 274, 231],
                },
            ],
        },
        {
            "1": {
                "begin": 0,
                "end": 0,
                "id": 1,
                "features": [
                    {
                        "frame": 0,
                        "bounds": [10, 10, 370, 500],
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [247.0, 101.0],
                                    },
                                    "properties": {"key": "head"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [202.0, 100.0],
                                    },
                                    "properties": {"key": "tail"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "LineString",
                                        "coordinates": [[247.0, 101.0], [202.0, 100.0]],
                                    },
                                    "properties": {"key": "HeadTails"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [
                                            [
                                                [40.0, 509.0],
                                                [26.0, 486.0],
                                                [20.0, 419.0],
                                                [28.0, 334.0],
                                                [51.0, 266.0],
                                                [85.0, 229.0],
                                                [102.0, 216.0],
                                                [118.0, 197.0],
                                                [125.0, 176.0],
                                            ]
                                        ],
                                    },
                                    "properties": {"key": ""},
                                },
                            ],
                        },
                    }
                ],
                "confidencePairs": [["astronaut", 1.0]],
                "attributes": {},
            },
            "2": {
                "begin": 0,
                "end": 0,
                "id": 2,
                "features": [
                    {
                        "frame": 0,
                        "bounds": [350, 5, 480, 295],
                    }
                ],
                "confidencePairs": [["rocket", 1.0]],
                "attributes": {},
            },
            "3": {
                "begin": 0,
                "end": 0,
                "id": 3,
                "features": [
                    {
                        "frame": 0,
                        "bounds": [326, 369, 600, 600],
                    }
                ],
                "confidencePairs": [["helmet", 1.0]],
                "attributes": {},
            },
        },
        {},
    ),
    (
        {
            # test if kwcoco superset is handled properly
            "images": [
                {"id": 1, "file_name": "img_00001.png"},
                {"id": 2, "file_name": "img_00002.png"},
            ],
            "annotations": [
                {
                    "segmentation": [
                        {
                            "exterior": [
                                [56, 239],
                                [55, 240],
                                [52, 240],
                                [54, 242],
                                [54, 250],
                                [53, 251],
                                [52, 251],
                                [52, 252],
                                [54, 254],
                                [54, 263],
                            ],
                            "interiors": [],
                        }
                    ],
                    "keypoints": [
                        {"xy": [87.85, 240.70], "keypoint_category_id": 1},
                        {"xy": [79.45, 251.54], "keypoint_category_id": 2},
                        {"xy": [58.45, 262.91], "keypoint_category_id": 3},
                    ],
                    "bbox": [49, 238, 42, 26],
                    "id": 1,
                    "image_id": 1,
                    "category_id": 7,
                },
                {
                    "segmentation": [{"exterior": [], "interiors": []}],
                    "keypoints": [{"xy": [136.825, 131.145], "keypoint_category_id": 3}],
                    "bbox": [73, 125, 69, 59],
                    "id": 2,
                    "image_id": 2,
                    "category_id": 7,
                },
                {
                    "segmentation": [
                        {
                            "exterior": [
                                [136, 52],
                                [133, 55],
                                [129, 55],
                                [129, 57],
                                [132, 60],
                                [131, 61],
                                [131, 62],
                                [130, 63],
                                [130, 64],
                            ],
                            "interiors": [],
                        }
                    ],
                    "keypoints": [
                        {"xy": [135.5, 59.03125], "keypoint_category_id": 1},
                        {"xy": [138.5, 59.03125], "keypoint_category_id": 2},
                    ],
                    "bbox": [129, 52, 16, 15],
                    "id": 3,
                    "image_id": 2,
                    "category_id": 6,
                },
                {
                    "segmentation": [
                        {
                            "exterior": [
                                [216, 199],
                                [216, 200],
                                [215, 201],
                                [214, 201],
                                [214, 204],
                                [215, 205],
                            ],
                            "interiors": [],
                        }
                    ],
                    "bbox": [212, 198, 20, 51],
                    "id": 4,
                    "image_id": 2,
                    "category_id": 7,
                },
                {
                    "segmentation": [],
                    "keypoints": [],
                    "bbox": [153, 151, 47, 32],
                    "id": 8,
                    "image_id": 2,
                    "category_id": 3,
                },
                {
                    "keypoints": [],
                    "bbox": [42, 240, 24, 14],
                    "area": 336.0,
                    "id": 9,
                    "image_id": 2,
                    "category_id": 7,
                },
            ],
            "categories": [
                {"id": 0, "name": "background"},
                {"name": "star", "id": 3},
                {"name": "superstar", "id": 6},
                {"name": "eff", "id": 7},
            ],
            "keypoint_categories": [
                {"name": "eye", "id": 3},
                {"name": "head", "id": 1},
                {"name": "tail", "id": 2},
            ],
        },
        {
            "1": {
                "begin": 0,
                "end": 0,
                "id": 1,
                "features": [
                    {
                        "frame": 0,
                        "bounds": [49, 238, 91, 264],
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [87.85, 240.7],
                                    },
                                    "properties": {"key": "head"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [79.45, 251.54],
                                    },
                                    "properties": {"key": "tail"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "LineString",
                                        "coordinates": [
                                            [87.85, 240.7],
                                            [79.45, 251.54],
                                        ],
                                    },
                                    "properties": {"key": "HeadTails"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [
                                            [
                                                [56.0, 239.0],
                                                [55.0, 240.0],
                                                [52.0, 240.0],
                                                [54.0, 242.0],
                                                [54.0, 250.0],
                                                [53.0, 251.0],
                                                [52.0, 251.0],
                                                [52.0, 252.0],
                                                [54.0, 254.0],
                                                [54.0, 263.0],
                                            ]
                                        ],
                                    },
                                    "properties": {"key": ""},
                                },
                            ],
                        },
                    }
                ],
                "confidencePairs": [["eff", 1.0]],
                "attributes": {},
            },
            "2": {
                "begin": 1,
                "end": 1,
                "id": 2,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [73, 125, 142, 184],
                    }
                ],
                "confidencePairs": [["eff", 1.0]],
                "attributes": {},
            },
            "3": {
                "begin": 1,
                "end": 1,
                "id": 3,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [129, 52, 145, 67],
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [135.5, 59.03125],
                                    },
                                    "properties": {"key": "head"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [138.5, 59.03125],
                                    },
                                    "properties": {"key": "tail"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "LineString",
                                        "coordinates": [
                                            [135.5, 59.03125],
                                            [138.5, 59.03125],
                                        ],
                                    },
                                    "properties": {"key": "HeadTails"},
                                },
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [
                                            [
                                                [136.0, 52.0],
                                                [133.0, 55.0],
                                                [129.0, 55.0],
                                                [129.0, 57.0],
                                                [132.0, 60.0],
                                                [131.0, 61.0],
                                                [131.0, 62.0],
                                                [130.0, 63.0],
                                                [130.0, 64.0],
                                            ]
                                        ],
                                    },
                                    "properties": {"key": ""},
                                },
                            ],
                        },
                    }
                ],
                "confidencePairs": [["superstar", 1.0]],
                "attributes": {},
            },
            "4": {
                "begin": 1,
                "end": 1,
                "id": 4,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [212, 198, 232, 249],
                        "geometry": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [
                                            [
                                                [216.0, 199.0],
                                                [216.0, 200.0],
                                                [215.0, 201.0],
                                                [214.0, 201.0],
                                                [214.0, 204.0],
                                                [215.0, 205.0],
                                            ]
                                        ],
                                    },
                                    "properties": {"key": ""},
                                }
                            ],
                        },
                    }
                ],
                "confidencePairs": [["eff", 1.0]],
                "attributes": {},
            },
            "8": {
                "begin": 1,
                "end": 1,
                "id": 8,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [153, 151, 200, 183],
                    }
                ],
                "confidencePairs": [["star", 1.0]],
                "attributes": {},
            },
            "9": {
                "begin": 1,
                "end": 1,
                "id": 9,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [42, 240, 66, 254],
                    }
                ],
                "confidencePairs": [["eff", 1.0]],
                "attributes": {},
            },
        },
        {},
    ),
    (
        {
            # test that videos are handled properly
            "categories": [
                {"id": 1, "name": "person"},
                {"id": 2, "name": "car"},
                {"id": 3, "name": "tree"},
            ],
            "videos": [{"id": 1, "name": "video.mp4"}],
            "images": [
                {"id": 1, "file_name": "00:00:00.666667", "frame_index": 10},
                {"id": 2, "file_name": "00:00:00.733333", "frame_index": 11},
                {"id": 3, "file_name": "00:00:00.800000", "frame_index": 12},
                {"id": 4, "file_name": "00:00:00.866667", "frame_index": 13},
                {"id": 5, "file_name": "00:00:00.933333", "frame_index": 14},
                {"id": 6, "file_name": "00:00:01.000000", "frame_index": 15},
                {"id": 7, "file_name": "00:00:01.066667", "frame_index": 16},
            ],
            "annotations": [
                {
                    "id": 1,
                    "image_id": 1,
                    "category_id": 1,
                    "bbox": [300.0, 103.0, 21.0, 31.0],
                    "score": 1.0,
                    "track_id": 8,
                },
                {
                    "id": 2,
                    "image_id": 2,
                    "category_id": 1,
                    "bbox": [299.0, 104.0, 21.0, 29.0],
                    "score": 1.0,
                    "track_id": 8,
                },
                {
                    "id": 174,
                    "image_id": 5,
                    "category_id": 2,
                    "bbox": [81.0, 41.0, 146.0, 72.0],
                    "score": 1.0,
                    "track_id": 4,
                },
                {
                    "id": 175,
                    "image_id": 6,
                    "category_id": 2,
                    "bbox": [81.0, 41.0, 146.0, 72.0],
                    "score": 1.0,
                    "track_id": 4,
                },
                {
                    "id": 391,
                    "image_id": 4,
                    "category_id": 3,
                    "bbox": [266.0, 8.0, 39.0, 45.0],
                    "score": 1.0,
                    "track_id": 5,
                },
                {
                    "id": 392,
                    "image_id": 5,
                    "category_id": 3,
                    "bbox": [266.0, 8.0, 39.0, 45.0],
                    "score": 1.0,
                    "track_id": 5,
                },
                {
                    "id": 393,
                    "image_id": 6,
                    "category_id": 3,
                    "bbox": [266.0, 8.0, 39.0, 45.0],
                    "score": 1.0,
                    "track_id": 5,
                },
            ],
        },
        {
            "8": {
                "begin": 10,
                "end": 11,
                "id": 8,
                "features": [
                    {
                        "frame": 10,
                        "bounds": [300, 103, 321, 134],
                    },
                    {
                        "frame": 11,
                        "bounds": [299, 104, 320, 133],
                    },
                ],
                "confidencePairs": [["person", 1.0]],
                "attributes": {},
            },
            "4": {
                "begin": 14,
                "end": 15,
                "id": 4,
                "features": [
                    {
                        "frame": 14,
                        "bounds": [81, 41, 227, 113],
                    },
                    {
                        "frame": 15,
                        "bounds": [81, 41, 227, 113],
                    },
                ],
                "confidencePairs": [["car", 1.0]],
                "attributes": {},
            },
            "5": {
                "begin": 13,
                "end": 15,
                "id": 5,
                "features": [
                    {
                        "frame": 13,
                        "bounds": [266, 8, 305, 53],
                    },
                    {
                        "frame": 14,
                        "bounds": [266, 8, 305, 53],
                    },
                    {
                        "frame": 15,
                        "bounds": [266, 8, 305, 53],
                    },
                ],
                "confidencePairs": [["tree", 1.0]],
                "attributes": {},
            },
        },
        {},
    ),
    (
        {
            # test that videos without any videos is handled properly
            "categories": [{"id": 1, "name": "person"}],
            "images": [
                {"id": 1, "file_name": "00:00:00.666667", "frame_index": 10},
                {"id": 2, "file_name": "00:00:00.733333", "frame_index": 11},
            ],
            "annotations": [
                {
                    "id": 45,
                    "image_id": 1,
                    "category_id": 1,
                    "bbox": [300.0, 103.0, 21.0, 31.0],
                    "score": 1.0,
                    "track_id": 8,
                },
                {
                    "id": 23,
                    "image_id": 2,
                    "category_id": 1,
                    "bbox": [299.0, 104.0, 21.0, 29.0],
                    "score": 1.0,
                    "track_id": 8,
                },
            ],
        },
        {
            "8": {
                "begin": 10,
                "end": 11,
                "id": 8,
                "features": [
                    {
                        "frame": 10,
                        "bounds": [300, 103, 321, 134],
                    },
                    {
                        "frame": 11,
                        "bounds": [299, 104, 320, 133],
                    },
                ],
                "confidencePairs": [["person", 1.0]],
                "attributes": {},
            }
        },
        {},
    ),
]


@pytest.mark.parametrize("input,expected_tracks,expected_attributes", test_tuple)
def test_read_kwcoco_json(
    input: Dict[str, List[dict]],
    expected_tracks: Dict[str, dict],
    expected_attributes: Dict[str, dict],
):
    converted, attributes, _, _ = kwcoco.load_coco_as_tracks_and_attributes(input)
    assert json.dumps(converted['tracks'], sort_keys=True) == json.dumps(
        expected_tracks, sort_keys=True
    )
    assert json.dumps(attributes, sort_keys=True) == json.dumps(expected_attributes, sort_keys=True)


def test_is_coco_json_without_info():
    coco = {
        "images": [{"id": 1, "file_name": "img_0001.jpg"}],
        "annotations": [{"id": 1, "image_id": 1, "category_id": 1, "bbox": [0, 0, 10, 10]}],
        "categories": [{"id": 1, "name": "fish"}],
    }
    assert kwcoco.is_coco_json(coco)


def test_export_dive_as_coco_single_dataset():
    tracks = [
        {
            "id": 7,
            "begin": 0,
            "end": 0,
            "confidencePairs": [["fish", 0.9]],
            "attributes": {"gear": "trawl"},
            "features": [
                {
                    "frame": 0,
                    "bounds": [10, 20, 30, 60],
                    "attributes": {"occluded": True},
                    "notes": ["net near reef"],
                }
            ],
        }
    ]
    image_filenames = {0: "frame_000000.jpg"}
    coco = kwcoco.export_dive_as_coco(tracks, image_filenames, dataset_name="demo")
    assert len(coco["images"]) == 1
    assert coco["images"][0]["file_name"] == "frame_000000.jpg"
    assert len(coco["annotations"]) == 1
    assert coco["annotations"][0]["track_id"] == 7
    assert coco["annotations"][0]["bbox"] == [10, 20, 20, 40]
    assert coco["annotations"][0]["dive_detection_attributes"] == {"occluded": True}
    assert coco["annotations"][0]["dive_track_attributes"] == {"gear": "trawl"}
    assert coco["annotations"][0]["dive_notes"] == ["net near reef"]
    assert "dive_notes" in coco["info"]["dive_extensions"]


def test_export_dive_as_coco_preserves_pairs_and_category_hierarchy_roundtrip():
    profile = KWCOCO_PROFILE['exportRoundTrip']
    exported = kwcoco.export_dive_as_coco(
        profile['tracks'],
        {int(frame): name for frame, name in profile['imageFilenames'].items()},
        dataset_name=profile['datasetName'],
        typeHierarchy=profile['typeHierarchy'],
    )
    categories = {category['name']: category for category in exported['categories']}
    assert list(categories) == profile['expectedCategoryNames']
    assert {
        name: category['supercategory']
        for name, category in categories.items()
        if 'supercategory' in category
    } == profile['expectedParents']
    annotation = exported['annotations'][0]
    assert annotation['track_id'] == profile['tracks'][0]['id']
    assert annotation['category_id'] == categories['leaf']['id']
    assert annotation['score'] == 0.75
    assert annotation['prob'] == profile['expectedProb']
    assert annotation['dive_confidence_pairs'] == profile['expectedPairs']
    assert 'dive_confidence_pairs' in exported['info']['dive_extensions']

    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(exported)
    track_id = str(profile['tracks'][0]['id'])
    assert converted['tracks'][track_id]['confidencePairs'] == [
        tuple(pair) for pair in profile['expectedPairs']
    ]
    assert warnings == []


# --- datasetInfo passthrough ---

DATASET_INFO = {
    "gfishsite_id": "2024TXN012",
    "cruise": "2403",
    "sta_lat": "26.8195",
    "year": "2024",
}

_EXPORT_TRACKS = [
    {
        "id": 1,
        "begin": 0,
        "end": 0,
        "confidencePairs": [["fish", 0.9]],
        "features": [{"frame": 0, "bounds": [10, 20, 30, 60]}],
    }
]


def test_export_dive_as_coco_writes_dataset_info():
    """A populated datasetInfo lands under info.dive_dataset_info and is advertised in dive_extensions."""
    coco = kwcoco.export_dive_as_coco(
        _EXPORT_TRACKS, {0: "frame_000000.jpg"}, dataset_name="demo", datasetInfo=DATASET_INFO
    )
    assert coco["info"]["dive_dataset_info"] == DATASET_INFO
    assert "dive_dataset_info" in coco["info"]["dive_extensions"]


@pytest.mark.parametrize("datasetInfo", [None, {}])
def test_export_dive_as_coco_omits_empty_dataset_info(datasetInfo):
    """No dive_dataset_info key (and dive_extensions unchanged) when empty/absent -> byte-unchanged."""
    coco = kwcoco.export_dive_as_coco(
        _EXPORT_TRACKS, {0: "frame_000000.jpg"}, dataset_name="demo", datasetInfo=datasetInfo
    )
    baseline = kwcoco.export_dive_as_coco(
        _EXPORT_TRACKS, {0: "frame_000000.jpg"}, dataset_name="demo"
    )
    assert "dive_dataset_info" not in coco["info"]
    assert "dive_dataset_info" not in coco["info"]["dive_extensions"]
    assert coco["info"] == baseline["info"]


def test_load_coco_restores_dataset_info():
    """info.dive_dataset_info is surfaced as the 4th return value for the caller to persist."""
    coco = {
        "info": {"dive_dataset_info": DATASET_INFO},
        "images": [{"id": 1, "file_name": "img_1.jpg"}],
        "annotations": [{"id": 1, "image_id": 1, "category_id": 1, "bbox": [1, 2, 3, 4]}],
        "categories": [{"id": 1, "name": "fish"}],
    }
    _converted, _attributes, _warnings, datasetInfo = kwcoco.load_coco_as_tracks_and_attributes(
        coco
    )
    assert datasetInfo == DATASET_INFO


def test_load_coco_without_dataset_info_returns_empty():
    """A COCO file with no info.dive_dataset_info yields an empty datasetInfo (nothing to persist)."""
    coco = {
        "images": [{"id": 1, "file_name": "img_1.jpg"}],
        "annotations": [{"id": 1, "image_id": 1, "category_id": 1, "bbox": [1, 2, 3, 4]}],
        "categories": [{"id": 1, "name": "fish"}],
    }
    _converted, _attributes, _warnings, datasetInfo = kwcoco.load_coco_as_tracks_and_attributes(
        coco
    )
    assert datasetInfo == {}


def test_dataset_info_export_import_roundtrip():
    """Export then re-import carries datasetInfo through unchanged (values are opaque strings)."""
    exported = kwcoco.export_dive_as_coco(
        _EXPORT_TRACKS, {0: "frame_000000.jpg"}, dataset_name="demo", datasetInfo=DATASET_INFO
    )
    _converted, _attributes, _warnings, datasetInfo = kwcoco.load_coco_as_tracks_and_attributes(
        exported
    )
    assert datasetInfo == DATASET_INFO


def test_import_dive_attribute_extensions():
    coco = {
        "images": [{"id": 1, "file_name": "img_1.jpg"}],
        "annotations": [
            {
                "id": 10,
                "image_id": 1,
                "category_id": 1,
                "bbox": [1, 2, 3, 4],
                "track_id": 5,
                "dive_detection_attributes": {"visibility": "poor"},
                "dive_track_attributes": {"reviewed": True},
                "dive_notes": ["first pass", "manual review"],
            }
        ],
        "categories": [{"id": 1, "name": "fish"}],
    }
    converted, _, _, _ = kwcoco.load_coco_as_tracks_and_attributes(coco)
    track = converted["tracks"]["5"]
    assert track["attributes"]["reviewed"] is True
    assert track["features"][0]["attributes"]["visibility"] == "poor"
    assert track["features"][0]["notes"] == ["first pass", "manual review"]


def test_import_rle_segmentation_skips_masks_with_warning():
    coco = {
        "images": [{"id": 1, "file_name": "img_1.jpg"}],
        "annotations": [
            {
                "id": 10,
                "image_id": 1,
                "category_id": 1,
                "bbox": [10, 20, 30, 40],
                "track_id": 5,
                "iscrowd": 1,
                "segmentation": {
                    "size": [480, 640],
                    "counts": "eNq...",
                },
            }
        ],
        "categories": [{"id": 1, "name": "fish"}],
    }
    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(coco)
    track = converted["tracks"]["5"]
    assert track["features"][0]["bounds"] == [10, 20, 40, 60]
    assert "geometry" not in track["features"][0]
    assert len(warnings) == 1
    assert "segmentation masks" in warnings[0]


def test_import_missing_bbox_raises_descriptive_error():
    coco = {
        "images": [{"id": 1, "file_name": "frame_000001.jpg", "frame_index": 0}],
        "annotations": [
            {
                "id": 1,
                "image_id": 1,
                "category_id": 1,
                "track_id": 201,
                "iscrowd": 1,
                "segmentation": {"size": [1080, 1920], "counts": "abc"},
            }
        ],
        "categories": [{"id": 1, "name": "fish"}],
    }
    with pytest.raises(ValueError) as exc:
        kwcoco.load_coco_as_tracks_and_attributes(coco)
    message = str(exc.value)
    assert "no bbox and no usable polygon" in message
    assert "RLE segmentation masks still require a bbox" in message


def test_import_polygon_without_bbox_derives_bounds():
    coco = {
        "images": [{"id": 1, "file_name": "frame_000001.jpg", "frame_index": 0}],
        "annotations": [
            {
                "id": 1,
                "image_id": 1,
                "category_id": 1,
                "track_id": 401,
                "segmentation": [[120, 80, 200, 80, 200, 120, 120, 120]],
            }
        ],
        "categories": [{"id": 1, "name": "fish"}],
    }
    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(coco)
    track = converted["tracks"]["401"]
    assert track["features"][0]["bounds"] == [120, 80, 200, 120]
    assert track["features"][0]["geometry"] is not None
    assert warnings == []


def test_import_polygon_and_rle_segmentation():
    coco = {
        "images": [{"id": 1, "file_name": "frame_000001.jpg", "frame_index": 0}],
        "annotations": [
            {
                "id": 1,
                "image_id": 1,
                "category_id": 1,
                "bbox": [120, 80, 80, 40],
                "track_id": 301,
                "segmentation": [[120, 80, 200, 80, 200, 120, 120, 120]],
            },
            {
                "id": 2,
                "image_id": 1,
                "category_id": 2,
                "bbox": [400, 200, 200, 60],
                "track_id": 302,
                "iscrowd": 1,
                "segmentation": {"size": [1080, 1920], "counts": "abc"},
            },
        ],
        "categories": [
            {"id": 1, "name": "person"},
            {"id": 2, "name": "crowd"},
        ],
    }
    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(coco)
    polygon_track = converted["tracks"]["301"]
    assert polygon_track["features"][0]["geometry"] is not None
    rle_track = converted["tracks"]["302"]
    assert rle_track["features"][0]["bounds"] == [400, 200, 600, 260]
    assert "geometry" not in rle_track["features"][0]
    assert len(warnings) == 1


def _classification_coco(categories, annotations):
    return {
        'images': [
            {'id': 1, 'file_name': 'frame_1.jpg', 'frame_index': 1},
            {'id': 2, 'file_name': 'frame_2.jpg', 'frame_index': 2},
        ],
        'annotations': annotations,
        'categories': categories,
    }


def _classification_annotation(annotation_id, image_id=1, **extra):
    return {
        'id': annotation_id,
        'image_id': image_id,
        'category_id': 1,
        'track_id': 9,
        'bbox': [1, 2, 3, 4],
        **extra,
    }


def test_prob_uses_raw_category_order_and_preserves_unnamed_slots():
    coco = _classification_coco(
        [{'id': 10, 'name': 'fish'}, {'id': 1}, {'id': 4, 'name': 'shark'}],
        [_classification_annotation(1, category_id=10, prob=[0.2, 0.9, 0.1])],
    )
    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(coco)
    assert converted['tracks']['9']['confidencePairs'] == [('fish', 0.2), ('shark', 0.1)]
    assert warnings == []


def test_unnamed_primary_category_falls_back_to_unknown():
    coco = _classification_coco(
        [{'id': 1}, {'id': 2, 'name': 'fish'}],
        [_classification_annotation(1, category_id=1)],
    )
    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(coco)
    assert converted['tracks']['9']['confidencePairs'] == [('unknown', 1.0)]
    assert warnings == []


def test_prob_prunes_and_warns_once_for_mismatch_or_duplicate_names():
    categories = [{'id': index, 'name': f'class_{index}'} for index in range(12)]
    annotations = [
        _classification_annotation(
            1,
            track_id=1,
            prob=[0.5 - index * 0.01 for index in range(12)],
        ),
        _classification_annotation(2, track_id=2, prob=[0.1]),
        _classification_annotation(3, track_id=3, prob=[0.2]),
    ]
    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(
        _classification_coco(categories, annotations)
    )
    assert len(converted['tracks']['1']['confidencePairs']) == 10
    assert warnings == [kwcoco.PROB_LENGTH_MISMATCH_WARNING]

    duplicate = _classification_coco(
        [{'id': 1, 'name': 'fish'}, {'id': 2, 'name': 'fish'}],
        [_classification_annotation(4, prob=[0.1, 0.9])],
    )
    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(duplicate)
    assert converted['tracks']['9']['confidencePairs'] == [('fish', 1.0)]
    assert warnings == [kwcoco.PROB_DUPLICATE_CATEGORY_WARNING]


def test_dive_confidence_pairs_prefer_exact_sparse_zero_membership():
    coco = _classification_coco(
        [{'id': 1, 'name': 'fish'}, {'id': 2, 'name': 'shark'}],
        [
            _classification_annotation(
                1,
                prob=[0.1, 0.9],
                dive_confidence_pairs=[['shark', 0.0], ['fish', 0.25]],
            )
        ],
    )
    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(coco)
    assert converted['tracks']['9']['confidencePairs'] == [('shark', 0.0), ('fish', 0.25)]
    assert warnings == []


@pytest.mark.parametrize(
    'value',
    [
        [],
        'not a pair list',
        [['fish']],
        [['fish', 0.2], ['fish', 0.3]],
        [['fish', float('nan')]],
        [['fish', 1.1]],
    ],
)
def test_malformed_dive_confidence_pairs_warns_once_and_falls_back(value):
    coco = _classification_coco(
        [{'id': 1, 'name': 'fish'}, {'id': 2, 'name': 'shark'}],
        [
            _classification_annotation(1, prob=[0.2, 0.8], dive_confidence_pairs=value),
            _classification_annotation(2, prob=[0.2, 0.8], dive_confidence_pairs=value),
        ],
    )

    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(coco)

    assert converted['tracks']['9']['confidencePairs'] == [('shark', 0.8), ('fish', 0.2)]
    assert warnings == [kwcoco.DIVE_CONFIDENCE_PAIRS_WARNING]


def test_highest_frame_confidence_wins_independent_of_source_order():
    categories = [{'id': 1, 'name': 'fish'}, {'id': 2, 'name': 'shark'}]
    annotations = [
        _classification_annotation(1, image_id=2, prob=[0.2, 0.8]),
        _classification_annotation(2, image_id=1, prob=[0.9, 0.1]),
    ]
    converted, _, _, _ = kwcoco.load_coco_as_tracks_and_attributes(
        _classification_coco(categories, annotations)
    )
    assert converted['tracks']['9']['confidencePairs'] == [('shark', 0.8), ('fish', 0.2)]


def test_same_highest_frame_uses_greater_annotation_id_independent_of_source_order():
    categories = [{'id': 1, 'name': 'fish'}, {'id': 2, 'name': 'shark'}]
    annotations = [
        _classification_annotation(2, prob=[0.9, 0.1]),
        _classification_annotation(1, prob=[0.2, 0.8]),
    ]
    document = _classification_coco(categories, annotations)

    converted, _, _, _ = kwcoco.load_coco_as_tracks_and_attributes(document)
    reordered, _, _, _ = kwcoco.load_coco_as_tracks_and_attributes(
        {**document, 'annotations': list(reversed(annotations))}
    )

    expected = [('fish', 0.9), ('shark', 0.1)]
    assert converted['tracks']['9']['confidencePairs'] == expected
    assert reordered['tracks']['9']['confidencePairs'] == expected


def test_supercategory_extraction_handles_roots_duplicates_and_multiple_parents():
    hierarchy, warnings = kwcoco.type_hierarchy_from_categories(
        {
            'categories': [
                {'id': 1, 'name': 'root', 'supercategory': 'root'},
                {'id': 2, 'name': 'leaf', 'supercategory': 'root', 'parents': ['root', 'other']},
                {'id': 3, 'name': 'external', 'supercategory': 'outside'},
                {'id': 4},
            ]
        }
    )
    assert hierarchy == {'leaf': 'root', 'external': 'outside'}
    assert warnings == [
        kwcoco.SUPERCATEGORY_MULTI_PARENT_WARNING,
        kwcoco.CATEGORY_MISSING_NAME_WARNING,
    ]

    hierarchy, warnings = kwcoco.type_hierarchy_from_categories(
        {'categories': [{'id': 1, 'name': 'fish'}, {'id': 2, 'name': 'fish'}]}
    )
    assert hierarchy is None
    assert warnings == [kwcoco.SUPERCATEGORY_DUPLICATE_CATEGORY_WARNING]

    hierarchy, warnings = kwcoco.type_hierarchy_from_categories(
        {
            'categories': [
                {'id': 1, 'name': 'fish'},
                {'id': 2, 'name': 'shark', 'parents': ['fish']},
                {'id': 3, 'name': 'tuna', 'supercategory': 'animal', 'parents': ['fish']},
                {'id': 4, 'name': 'whale', 'parents': ['mammal', 'fish']},
            ]
        }
    )
    assert hierarchy == {'shark': 'fish', 'tuna': 'animal'}
    assert warnings == [kwcoco.SUPERCATEGORY_MULTI_PARENT_WARNING]


def test_shared_exact_vector_and_hierarchy_import_profile():
    profile = KWCOCO_PROFILE['highestFrameExact']

    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(profile['document'])
    hierarchy, hierarchy_warnings = kwcoco.type_hierarchy_from_categories(profile['document'])

    pairs = converted['tracks'][str(profile['trackId'])]['confidencePairs']
    assert [list(pair) for pair in pairs] == profile['expectedPairs']
    assert hierarchy == profile['expectedHierarchy']
    assert warnings == []
    assert hierarchy_warnings == []


def test_shared_missing_frame_index_profile():
    profile = KWCOCO_PROFILE['missingFrameIndexExact']

    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(profile['document'])

    pairs = converted['tracks'][str(profile['trackId'])]['confidencePairs']
    assert [list(pair) for pair in pairs] == profile['expectedPairs']
    assert warnings == []


def test_shared_empty_dive_confidence_pairs_profile():
    profile = KWCOCO_PROFILE['emptyDiveConfidencePairs']

    converted, _, warnings, _ = kwcoco.load_coco_as_tracks_and_attributes(profile['document'])

    pairs = converted['tracks'][str(profile['trackId'])]['confidencePairs']
    assert [list(pair) for pair in pairs] == profile['expectedPairs']
    assert warnings == [kwcoco.DIVE_CONFIDENCE_PAIRS_WARNING]


def _fps_document(videos=None):
    document = {
        'images': [{'id': 1, 'file_name': 'frame_000000.png', 'frame_index': 0}],
        'annotations': [
            {'id': 1, 'image_id': 1, 'category_id': 1, 'bbox': [0, 0, 1, 1], 'track_id': 1}
        ],
        'categories': [{'id': 1, 'name': 'fish'}],
    }
    if videos is not None:
        document['videos'] = videos
    return document


def test_frame_rate_read_from_video():
    """The COCO counterpart of the VIAME CSV header's fps."""
    assert kwcoco.frame_rate_from_coco(
        _fps_document([{'id': 1, 'name': 'clip', 'fps': 5}])
    ) == 5.0
    assert kwcoco.frame_rate_from_coco(
        _fps_document([{'id': 1}, {'id': 2, 'name': 'clip', 'fps': 29.97}])
    ) == 29.97


def test_frame_rate_absent_or_unusable():
    """An image sequence carries no rate, and no caller should see fps: 0."""
    assert kwcoco.frame_rate_from_coco(_fps_document()) is None
    assert kwcoco.frame_rate_from_coco(_fps_document([])) is None
    for fps in [0, -5, '5', True, float('inf'), float('nan'), None]:
        assert kwcoco.frame_rate_from_coco(
            _fps_document([{'id': 1, 'fps': fps}])
        ) is None
