"""Reserved-name predicate for a dataset's frame metadata attachment.

Keep this mirrored with ``client/dive-common/frameMetadata/naming.ts``, which implements the same
basename predicate over the same six names for the desktop and web importers. A name in this set is
read as a frame metadata attachment instead of being imported as annotations, so the two sides
disagreeing means one platform imports a file the other attaches. The shared fixture
``testutils/framemetadata.spec.json`` pins the truth table for both.

One term throughout: the file is an *attachment*, and a name in this set *declares* it.

Assetstore import also accepts a video-paired sidecar name ``{videoStem}[-_]metadata.{ext}`` and
renames it to the canonical reserved basename before postprocess. That pairing lives only on the
import path; discovery and postprocess continue to key off the reserved names below.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

FRAME_METADATA_SOURCE_NAMES = {
    'frame-metadata.csv',
    'frame-metadata.json',
    'frame-metadata.txt',
    'frame_metadata.csv',
    'frame_metadata.json',
    'frame_metadata.txt',
}
PATH_SPLIT_RE = re.compile(r'[/\\]')
# ``reef.mp4`` ↔ ``reef_metadata.csv`` / ``reef-metadata.json`` / ``reef_metadata.txt``
VIDEO_PAIRED_METADATA_RE = re.compile(
    r'^(.+)[-_]metadata\.(csv|json|txt)$',
    re.IGNORECASE,
)


def is_frame_metadata_source_name(name: str) -> bool:
    """A frame metadata sidecar is declared by basename."""
    basename = PATH_SPLIT_RE.split(name)[-1]
    return basename.lower() in FRAME_METADATA_SOURCE_NAMES


def parse_video_paired_metadata_name(name: str) -> Optional[Tuple[str, str]]:
    """If *name* is ``{videoStem}[-_]metadata.{ext}``, return ``(videoStem, ext)``.

    Used by assetstore import only. Extension is lowercased. Reserved names like
    ``frame_metadata.csv`` also match this pattern (stem ``frame``); callers that already
    checked :func:`is_frame_metadata_source_name` should keep that check first so reserved
    files are not treated as video-paired.
    """
    basename = PATH_SPLIT_RE.split(name)[-1]
    match = VIDEO_PAIRED_METADATA_RE.match(basename)
    if not match:
        return None
    return match.group(1), match.group(2).lower()


def canonical_frame_metadata_name(ext: str) -> str:
    """Return the underscore reserved basename for *ext* (``frame_metadata.csv``, etc.)."""
    return f'frame_metadata.{ext.lstrip(".").lower()}'


def frame_metadata_source_name_query() -> dict:
    """Mongo predicate matching a declared frame-metadata sidecar by reserved basename.

    The query-side mirror of is_frame_metadata_source_name: Girder item names are basenames
    (no path separators) and ``lowerName`` is the lowercased name, so an exact ``$in`` over the
    reserved set is exactly that predicate -- and, unlike a regex, it can use the ``lowerName``
    index. Deriving it from the constant keeps the query from drifting as the reserved set changes.
    """
    return {'lowerName': {'$in': sorted(FRAME_METADATA_SOURCE_NAMES)}}
