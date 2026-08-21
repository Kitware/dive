import math

import pytest

from dive_utils.serializers import dive

test_tuple = [
    (
        {"1": {"trackId": 1, 'begin': 0, 'end': 1, 'features': []}},
        {
            "tracks": {
                "1": {
                    "id": 1,
                    "begin": 0,
                    "end": 1,
                    "features": [],
                    "attributes": {},
                    "confidencePairs": [],
                }
            },
            "groups": {},
            "version": 2,
        },
    ),
    (
        {},
        {"tracks": {}, "groups": {}, "version": 2},
    ),
]


@pytest.mark.parametrize("input,expected", test_tuple)
def test_migrate(input, expected):
    assert dive.migrate(input) == expected


def _v2_document(**extra):
    return {
        "tracks": {
            "1": {
                "id": 1,
                "begin": 0,
                "end": 0,
                "features": [],
                "attributes": {},
                "confidencePairs": [["fish", 1.0]],
            }
        },
        "groups": {},
        "version": 2,
        **extra,
    }


def test_migrate_preserves_usable_fps():
    migrated = dive.migrate(_v2_document(fps=5))
    assert migrated["fps"] == 5.0
    assert dive.frame_rate_from_dive(migrated) == 5.0


@pytest.mark.parametrize("fps", [0, -1, "5", True, None, float("inf"), float("nan")])
def test_migrate_drops_unusable_fps(fps):
    migrated = dive.migrate(_v2_document(fps=fps))
    assert "fps" not in migrated
    assert dive.frame_rate_from_dive(_v2_document(fps=fps)) is None


def test_frame_rate_from_dive_absent():
    assert dive.frame_rate_from_dive(_v2_document()) is None
    assert dive.frame_rate_from_dive("not-a-dict") is None


def test_frame_rate_rejects_nan_explicitly():
    # math.isfinite is the gate; keep the helper honest about nan.
    assert not math.isfinite(float("nan"))
    assert dive.frame_rate_from_dive({"fps": float("nan")}) is None
