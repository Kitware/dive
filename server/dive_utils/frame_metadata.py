"""Frame-metadata sidecar name predicate.

DIVE reserves ``frame-metadata.csv`` and ``frame-metadata.txt`` as the preferred
declared frame-metadata sidecar files; ``frame_metadata.csv`` and
``frame_metadata.txt`` are also accepted (case-insensitive basenames). This module
is the Python mirror of the shared TypeScript predicate; it classifies by name
only and never parses frame metadata.
"""

import re

from dive_utils import asbool, constants, fromMeta

FRAME_METADATA_SOURCE_NAMES = {
    'frame-metadata.csv',
    'frame-metadata.txt',
    'frame_metadata.csv',
    'frame_metadata.txt',
}
PATH_SPLIT_RE = re.compile(r'[/\\]')


def is_frame_metadata_source_name(name: str) -> bool:
    """A frame metadata sidecar is declared by basename."""
    basename = PATH_SPLIT_RE.split(name)[-1]
    return basename.lower() in FRAME_METADATA_SOURCE_NAMES


def is_declared_frame_metadata(item: dict) -> bool:
    """A folder item is a declared frame-metadata sidecar.

    Declared either by the reserved basename or by the explicit-import item marker. Both
    the discovery path and the annotation sweep exclude these from annotation classification.
    """
    return is_frame_metadata_source_name(item['name']) or asbool(
        fromMeta(item, constants.FrameMetadataMarker)
    )
