import pytest

from dive_utils.serializers import dive

test_tuple = [
    (
        {"1": {"trackId": 1}},
        {"tracks": {"1": {"id": 1}}, "groups": {}, "version": 2},
    ),
    (
        {},
        {"tracks": {}, "groups": {}, "version": 2},
    ),
]


@pytest.mark.parametrize("input,expected", test_tuple)
def test_migrate(input, expected):
    assert dive.migrate(input) == expected
