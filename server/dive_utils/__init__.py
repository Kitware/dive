"""Utilities that are common to both the viame server and tasks package."""
import itertools
import re
from typing import Any, Dict, List, Union
import unicodedata

from girder.api.rest import setResponseHeader

from dive_utils.types import GirderModel

TRUTHY_META_VALUES = ['yes', '1', 1, 'true', 't', 'True', True]
NUMBERS_REGEX = re.compile(r'(\d+)')
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


def _maybeInt(input: str) -> Union[str, int]:
    try:
        return int(input)
    except ValueError:
        return input


def _strChunks(input: str) -> List[Union[int, str]]:
    chunks = NUMBERS_REGEX.split(input)
    return [_maybeInt(v) for v in chunks if v != '']


def strNumericCompare(input1: str, input2: str) -> int:
    """
    Convert a string to an int key for sorting
    Where its numerical components are weighted above
    its non-numerical components
    """
    if input1 == input2:
        return 0
    for a, b in itertools.zip_longest(_strChunks(input1), _strChunks(input2), fillvalue=None):
        if a == b:
            continue
        if a is None:
            return -1
        if b is None:
            return 1
        if type(a) == int and type(b) == int:
            return a - b
        if type(a) == int:
            return -1
        if type(b) == int:
            return 1
        return 1 if a > b else -1
    return 0


def slugify(value, allow_unicode=False):
    """
    Taken from https://github.com/django/django/blob/master/django/utils/text.py
    Convert to ASCII if 'allow_unicode' is False. Convert spaces or repeated
    dashes to single dashes. Remove characters that aren't alphanumerics,
    underscores, or hyphens. Convert to lowercase. Also strip leading and
    trailing whitespace, dashes, and underscores.
    NOTE: Slightly modified to allow '.' for extensions and non-stripping of '-' and '_'
    """
    value = str(value)
    if allow_unicode:
        value = unicodedata.normalize('NFKC', value)
    else:
        value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s\.-]', '', value.lower())
    value = re.sub(r'[-\s]+', '-', value)
    if '.' in value and len(value.split('.')) == 1:  # all unicode stripped, gives back sample.ext
        value = f"sample{value}"
    return re.sub(r'[-\s]+', '-', value)


def setContentDisposition(filename: str, disposition='attachment', mime='application/json'):
    if disposition == 'attachment':
        setResponseHeader('Content-Type', mime)
        filename = slugify(filename)
        setResponseHeader('Content-Disposition', f'attachment; filename={filename}')
