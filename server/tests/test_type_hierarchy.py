import json
from pathlib import Path
from typing import Any, Dict

import pytest

from dive_utils.type_hierarchy import (
    TypeHierarchyError,
    normalize_type_hierarchy,
    resolve_type_hierarchy,
)

with (Path(__file__).parents[2] / 'testutils' / 'typeHierarchy.spec.json').open(
    encoding='utf-8'
) as fp:
    CORPUS = json.load(fp)


def _case_id(test_case: Dict[str, Any]) -> str:
    return test_case['name']


def _assert_hierarchy_error(error: TypeHierarchyError, test_case: Dict[str, Any]) -> None:
    assert error.reason == test_case['errorReason']
    assert error.kind == test_case['errorKind']
    assert str(error) == test_case['errorReason']


@pytest.mark.parametrize('test_case', CORPUS['normalizationCases'], ids=_case_id)
def test_normalization_case(test_case):
    if test_case['errorReason'] is not None:
        with pytest.raises(TypeHierarchyError) as error_info:
            normalize_type_hierarchy(test_case['input'])
        _assert_hierarchy_error(error_info.value, test_case)
    else:
        assert normalize_type_hierarchy(test_case['input']) == test_case['expected']


@pytest.mark.parametrize('test_case', CORPUS['resolutionCases'], ids=_case_id)
def test_resolution_case(test_case):
    incoming = test_case.get('incoming')
    if test_case['errorReason'] is not None:
        with pytest.raises(TypeHierarchyError) as error_info:
            resolve_type_hierarchy(
                test_case['existing'],
                test_case['incomingPresent'],
                incoming,
                test_case['mode'],
            )
        _assert_hierarchy_error(error_info.value, test_case)
    else:
        write = resolve_type_hierarchy(
            test_case['existing'],
            test_case['incomingPresent'],
            incoming,
            test_case['mode'],
        )
        assert write['action'] == test_case['expectedAction']
        if write['action'] == 'set':
            assert write['hierarchy'] == test_case['expected']
        else:
            assert 'hierarchy' not in write
