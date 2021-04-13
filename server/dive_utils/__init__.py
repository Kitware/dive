"""Utilities that are common to both the viame server and tasks package."""
import math
import re
from typing import Any, Dict, Union

from dive_utils.types import GirderModel

TRUTHY_META_VALUES = ['yes', '1', 1, 'true', 't', 'True', True]
NUMBERS_REGEX = re.compile(r'\d+')
NOT_NUMBERS_REGEX = re.compile(r'[^\d]+')


def asbool(value: Union[str, None, bool]) -> bool:
    """Convert freeform mongo metadata value into a boolean"""
    return str(value).lower() in TRUTHY_META_VALUES


def fromMeta(
    obj: Union[Dict[str, Any], GirderModel], key: str, default=None, required=False
) -> Any:
    """Safely get a property from girder metadata"""
    if not required:
        return obj.get("meta", {}).get(key, default)
    else:
        return obj["meta"][key]


def strNumericKey(input: str) -> int:
    numbers_str = ''.join(NUMBERS_REGEX.findall(input))
    numbers_value = int(numbers_str) if numbers_str else 0
    return numbers_value


def strNumericCompare(input1: str, input2: str) -> float:
    """
    Convert a string to a float key for sorting
    Where its numerical components are weighted above
    its non-numerical components
    """
    if input1 == input2:
        return 0
    num1 = strNumericKey(input1)
    num2 = strNumericKey(input2)
    if num1 == num2:
        return 1 if input1 > input2 else -1
    return num1 - num2
