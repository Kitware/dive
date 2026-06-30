import csv
from dataclasses import dataclass
import io
import os
import re
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from dive_utils import constants
from dive_utils.serializers import viame


@dataclass(frozen=True)
class ParsedFrameMetadata:
    source_name: Optional[str]
    header: List[str]
    rows: List[Dict[str, str]]
    join_columns: List[str]
    payload_columns: List[str]
    records: Dict[str, Dict[str, str]]


def normalize_key(value: str) -> str:
    """Normalize a media filename the same way valid_image_names_dict keys images."""
    basename = os.path.basename(str(value).strip())
    stem, ext = os.path.splitext(basename)
    if ext.lower().lstrip('.') in constants.allValidLargeImageFormats:
        return stem
    return basename


def parse_table(text: str) -> Tuple[List[str], List[Dict[str, str]]]:
    raw_rows = _read_rows(text)
    if not raw_rows:
        return [], []

    header = [cell.strip() for cell in raw_rows[0]]
    if not all(header):
        return [], []

    rows: List[Dict[str, str]] = []
    for raw_row in raw_rows[1:]:
        values = [cell.strip() for cell in raw_row]
        if not any(values):
            continue
        values = values[: len(header)] + [''] * max(0, len(header) - len(values))
        rows.append(dict(zip(header, values)))
    return header, rows


def find_join_columns(
    header: Sequence[str],
    rows: Iterable[Mapping[str, str]],
    media_keys: Mapping[str, int],
) -> List[str]:
    normalized_media_keys = _normalized_media_keys(media_keys)
    materialized_rows = list(rows)
    return [
        column
        for column in header
        if any(
            row.get(column) and normalize_key(row[column]) in normalized_media_keys
            for row in materialized_rows
        )
    ]


def is_frame_metadata(text: str, media_keys: Mapping[str, int]) -> bool:
    return parse_frame_metadata_source(text, media_keys) is not None


def parse_frame_metadata_source(
    text: str,
    media_keys: Mapping[str, int],
    source_name: Optional[str] = None,
) -> Optional[ParsedFrameMetadata]:
    if viame.is_viame_csv(text.splitlines(), dict(media_keys)):
        return None

    header, rows = parse_table(text)
    if not header or not rows:
        return None

    join_columns = find_join_columns(header, rows, media_keys)
    if not join_columns:
        return None

    payload_columns = [column for column in header if column not in join_columns]
    if not payload_columns:
        return None

    records: Dict[str, Dict[str, str]] = {}
    normalized_media_keys = _normalized_media_keys(media_keys)
    for row in rows:
        for column in join_columns:
            key = normalize_key(row.get(column, ''))
            if key in normalized_media_keys:
                records[key] = {field: row.get(field, '') for field in header}

    if not records:
        return None

    return ParsedFrameMetadata(
        source_name=source_name,
        header=list(header),
        rows=rows,
        join_columns=join_columns,
        payload_columns=payload_columns,
        records=records,
    )


def select_frame_metadata_source(
    candidates: Iterable[Tuple[str, str]],
    media_keys: Mapping[str, int],
) -> Optional[ParsedFrameMetadata]:
    matches: List[ParsedFrameMetadata] = []
    for source_name, text in candidates:
        if not _is_text_candidate(source_name):
            continue
        source = parse_frame_metadata_source(text, media_keys, source_name=source_name)
        if source is not None:
            matches.append(source)

    if len(matches) != 1:
        return None
    return matches[0]


def _read_rows(text: str) -> List[List[str]]:
    first_line = _first_nonempty_line(text)
    if first_line is None:
        return []

    delimiter = _sniff_delimiter(first_line)
    if delimiter is None:
        return [re.split(r'\s+', line.strip()) for line in text.splitlines() if line.strip()]

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    return [
        [cell.strip() for cell in row]
        for row in reader
        if row and any(cell.strip() for cell in row)
    ]


def _first_nonempty_line(text: str) -> Optional[str]:
    for line in text.splitlines():
        if line.strip():
            return line.strip()
    return None


def _sniff_delimiter(line: str) -> Optional[str]:
    if ',' in line:
        return ','
    if '\t' in line:
        return '\t'
    return None


def _normalized_media_keys(media_keys: Mapping[str, int]) -> set:
    return {normalize_key(key) for key in media_keys}


def _is_text_candidate(source_name: str) -> bool:
    return os.path.splitext(source_name.lower())[1] in {'.txt', '.csv'}
