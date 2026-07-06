"""Python side of the frame-metadata naming parity contract.

``frame_metadata`` / ``frame-metadata`` with a ``.csv`` or ``.txt`` extension is the
single declared-by-name flag that travels every ingestion path. The predicate is mirrored
in Python (``dive_utils.frame_metadata``) and in the shared TypeScript module; both
harnesses assert the same accepted/rejected truth table so the two mirrors can never
drift. This is the only mirrored logic left in the feature.
"""

import json
from pathlib import Path

from dive_utils.frame_metadata import is_frame_metadata_source_name

SOURCE_NAMES_FIXTURE = (
    Path(__file__).parents[2]
    / 'testdata'
    / 'frame-metadata-conformance'
    / 'source_names.expected.json'
)


def test_source_names_predicate_matches_shared_truth_table():
    truth_table = json.loads(SOURCE_NAMES_FIXTURE.read_text(encoding='utf-8'))
    assert truth_table, 'source_names truth table fixture is empty'
    for name, expected in truth_table.items():
        assert is_frame_metadata_source_name(name) is expected, name
