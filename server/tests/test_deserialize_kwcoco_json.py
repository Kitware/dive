import json
from typing import Dict, List, Tuple

import pytest

from dive_utils.serializers import kwcoco

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
                "trackId": 1,
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
                        "interpolate": False,
                        "keyframe": True,
                    }
                ],
                "confidencePairs": [["astronaut", 1.0]],
                "attributes": {},
            },
            "2": {
                "begin": 0,
                "end": 0,
                "trackId": 2,
                "features": [
                    {
                        "frame": 0,
                        "bounds": [350, 5, 480, 295],
                        "interpolate": False,
                        "keyframe": True,
                    }
                ],
                "confidencePairs": [["rocket", 1.0]],
                "attributes": {},
            },
            "3": {
                "begin": 0,
                "end": 0,
                "trackId": 3,
                "features": [
                    {
                        "frame": 0,
                        "bounds": [326, 369, 600, 600],
                        "interpolate": False,
                        "keyframe": True,
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
                "trackId": 1,
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
                        "interpolate": False,
                        "keyframe": True,
                    }
                ],
                "confidencePairs": [["eff", 1.0]],
                "attributes": {},
            },
            "2": {
                "begin": 1,
                "end": 1,
                "trackId": 2,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [73, 125, 142, 184],
                        "interpolate": False,
                        "keyframe": True,
                    }
                ],
                "confidencePairs": [["eff", 1.0]],
                "attributes": {},
            },
            "3": {
                "begin": 1,
                "end": 1,
                "trackId": 3,
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
                        "interpolate": False,
                        "keyframe": True,
                    }
                ],
                "confidencePairs": [["superstar", 1.0]],
                "attributes": {},
            },
            "4": {
                "begin": 1,
                "end": 1,
                "trackId": 4,
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
                        "interpolate": False,
                        "keyframe": True,
                    }
                ],
                "confidencePairs": [["eff", 1.0]],
                "attributes": {},
            },
            "8": {
                "begin": 1,
                "end": 1,
                "trackId": 8,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [153, 151, 200, 183],
                        "interpolate": False,
                        "keyframe": True,
                    }
                ],
                "confidencePairs": [["star", 1.0]],
                "attributes": {},
            },
            "9": {
                "begin": 1,
                "end": 1,
                "trackId": 9,
                "features": [
                    {
                        "frame": 1,
                        "bounds": [42, 240, 66, 254],
                        "interpolate": False,
                        "keyframe": True,
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
                "trackId": 8,
                "features": [
                    {
                        "frame": 10,
                        "bounds": [300, 103, 321, 134],
                        "interpolate": False,
                        "keyframe": True,
                    },
                    {
                        "frame": 11,
                        "bounds": [299, 104, 320, 133],
                        "interpolate": False,
                        "keyframe": True,
                    },
                ],
                "confidencePairs": [["person", 1.0]],
                "attributes": {},
            },
            "4": {
                "begin": 14,
                "end": 15,
                "trackId": 4,
                "features": [
                    {
                        "frame": 14,
                        "bounds": [81, 41, 227, 113],
                        "interpolate": False,
                        "keyframe": True,
                    },
                    {
                        "frame": 15,
                        "bounds": [81, 41, 227, 113],
                        "interpolate": False,
                        "keyframe": True,
                    },
                ],
                "confidencePairs": [["car", 1.0]],
                "attributes": {},
            },
            "5": {
                "begin": 13,
                "end": 15,
                "trackId": 5,
                "features": [
                    {
                        "frame": 13,
                        "bounds": [266, 8, 305, 53],
                        "interpolate": False,
                        "keyframe": True,
                    },
                    {
                        "frame": 14,
                        "bounds": [266, 8, 305, 53],
                        "interpolate": False,
                        "keyframe": True,
                    },
                    {
                        "frame": 15,
                        "bounds": [266, 8, 305, 53],
                        "interpolate": False,
                        "keyframe": True,
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
                "trackId": 8,
                "features": [
                    {
                        "frame": 10,
                        "bounds": [300, 103, 321, 134],
                        "interpolate": False,
                        "keyframe": True,
                    },
                    {
                        "frame": 11,
                        "bounds": [299, 104, 320, 133],
                        "interpolate": False,
                        "keyframe": True,
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
    (tracks, attributes) = kwcoco.load_coco_as_tracks_and_attributes(input)
    print(expected_tracks.keys())
    print(tracks.keys())
    assert json.dumps(tracks, sort_keys=True) == json.dumps(expected_tracks, sort_keys=True)
    assert json.dumps(attributes, sort_keys=True) == json.dumps(expected_attributes, sort_keys=True)
