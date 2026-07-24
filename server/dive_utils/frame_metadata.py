"""Reserved-name predicate for a dataset's frame metadata attachment.

Keep this mirrored with ``client/dive-common/frameMetadata/naming.ts``, which implements the same
basename predicate over the same six names for the desktop and web importers. A name in this set is
read as a frame metadata attachment instead of being imported as annotations, so the two sides
disagreeing means one platform imports a file the other attaches. The shared fixture
``testutils/framemetadata.spec.json`` pins the truth table for both.

One term throughout: the file is an *attachment*, and a name in this set *declares* it.
"""

import re

FRAME_METADATA_SOURCE_NAMES = {
    'frame-metadata.csv',
    'frame-metadata.json',
    'frame-metadata.txt',
    'frame_metadata.csv',
    'frame_metadata.json',
    'frame_metadata.txt',
}
PATH_SPLIT_RE = re.compile(r'[/\\]')


def is_frame_metadata_source_name(name: str) -> bool:
    """A frame metadata sidecar is declared by basename."""
    basename = PATH_SPLIT_RE.split(name)[-1]
    return basename.lower() in FRAME_METADATA_SOURCE_NAMES


def frame_metadata_source_name_query() -> dict:
    """Mongo predicate matching a declared frame-metadata sidecar by reserved basename.

    The query-side mirror of is_frame_metadata_source_name: Girder item names are basenames
    (no path separators) and ``lowerName`` is the lowercased name, so an exact ``$in`` over the
    reserved set is exactly that predicate -- and, unlike a regex, it can use the ``lowerName``
    index. Deriving it from the constant keeps the query from drifting as the reserved set changes.
    """
    return {'lowerName': {'$in': sorted(FRAME_METADATA_SOURCE_NAMES)}}
