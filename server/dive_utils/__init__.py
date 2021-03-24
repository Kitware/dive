"""Utilities that are common to both the viame server and tasks package."""
from typing import Any, Dict, Union

TRUTHY_META_VALUES = ['yes', '1', 1, 'true', 't', 'True', True]


def asbool(value: Union[str, None, bool]) -> bool:
    """Convert freeform mongo metadata value into a boolean"""
    return str(value).lower() in TRUTHY_META_VALUES


def fromMeta(obj: Dict[str, Any], key: str, default=None, required=False) -> Any:
    """Safely get a property from girder metadata"""
    if not required:
        return obj.get("meta", {}).get(key, default)
    else:
        return obj["meta"][key]
