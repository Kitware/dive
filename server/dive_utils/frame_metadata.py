"""Frame-metadata sidecar name predicate.

DIVE reserves ``*.meta.csv`` / ``*.meta.txt`` (case-insensitive) as declared
frame-metadata sidecar files. This module is the Python mirror of the shared
TypeScript predicate; it classifies by name only and never parses telemetry.
"""

import re

FRAME_METADATA_SOURCE_NAME_RE = re.compile(r'\.meta\.(csv|txt)$', re.IGNORECASE)


def is_frame_metadata_source_name(name: str) -> bool:
    """A telemetry sidecar is declared by name: it ends in ``.meta.csv``/``.meta.txt``."""
    return FRAME_METADATA_SOURCE_NAME_RE.search(name) is not None
