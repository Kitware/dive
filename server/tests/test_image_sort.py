import functools
import json

import pytest

from dive_utils import strNumericCompare

with open('../testutils/imagesort.spec.json', 'r') as fp:
    test_tuple = json.load(fp)


@pytest.mark.parametrize("input,expected", test_tuple)
def test_utils_sort(input, expected):
    print(sorted(input, key=functools.cmp_to_key(strNumericCompare)))
    assert sorted(input, key=functools.cmp_to_key(strNumericCompare)) == expected
