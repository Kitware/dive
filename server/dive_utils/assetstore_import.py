"""Helpers for pairing assetstore-imported files with DIVE datasets."""

from __future__ import annotations

import os

# Optional annotation filename suffixes stripped when pairing with a video stem.
ANNOTATION_MEDIA_SUFFIXES = ('_detections', '_tracks')


def annotation_media_stem(annotation_filename: str) -> str:
    """Return the media stem used to pair an annotation with a video dataset.

    ``reef.csv``, ``reef_tracks.json``, and ``reef_detections.csv`` all resolve
    to ``reef``.
    """
    stem = os.path.splitext(os.path.basename(annotation_filename))[0]
    lower = stem.lower()
    for suffix in ANNOTATION_MEDIA_SUFFIXES:
        if lower.endswith(suffix):
            return stem[: -len(suffix)]
    return stem
