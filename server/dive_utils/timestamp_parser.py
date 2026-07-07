"""
Frame capture timestamp parsing from a filename, using a small ordered list of
conventions (SEAL feature 5).

The primary convention is KAMERA's, confirmed against sample data: a
YYYYMMDD_HHMMSS.ffffff datestamp embedded in names like
kamera_calibration_fl02_C_20240407_130757.206341_ir.tif. The remaining
epoch-based patterns are fallbacks for other capture systems; extend the list
as additional conventions surface.

Mirrors client/platform/desktop/sharedUtils.ts's parseFrameTimestamp -- keep the
two implementations in sync.
"""

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, List, Match, NamedTuple, Optional

# Roughly year 2000 to year 2100, used to reject implausible epoch candidates
_MIN_PLAUSIBLE_EPOCH_SECONDS = 946684800
_MAX_PLAUSIBLE_EPOCH_SECONDS = 4102444800


def _is_plausible_epoch_seconds(seconds: float) -> bool:
    return _MIN_PLAUSIBLE_EPOCH_SECONDS <= seconds <= _MAX_PLAUSIBLE_EPOCH_SECONDS


def _datestamp_to_seconds(match: Match) -> Optional[float]:
    year, month, day, hour, minute, second, frac = match.groups()
    month_i, day_i, hour_i, minute_i, second_i = (
        int(month),
        int(day),
        int(hour),
        int(minute),
        int(second),
    )
    if month_i < 1 or month_i > 12:
        return None
    if day_i < 1 or day_i > 31:
        return None
    if hour_i > 23 or minute_i > 59 or second_i > 59:
        return None
    try:
        dt = datetime(
            int(year), month_i, day_i, hour_i, minute_i, second_i, tzinfo=timezone.utc
        )
    except ValueError:
        # e.g. Feb 30 -- a valid-looking but nonexistent calendar date
        return None
    frac_seconds = float(f'0.{frac}') if frac else 0.0
    return dt.timestamp() + frac_seconds


def _epoch_millis_to_seconds(match: Match) -> Optional[float]:
    seconds = int(match.group(1)) / 1000
    return seconds if _is_plausible_epoch_seconds(seconds) else None


def _epoch_seconds_to_seconds(match: Match) -> Optional[float]:
    seconds = float(match.group(1))
    return seconds if _is_plausible_epoch_seconds(seconds) else None


class _FrameTimestampPattern(NamedTuple):
    name: str
    regex: re.Pattern
    to_seconds: Callable[[Match], Optional[float]]


# Tried in order against the extension-stripped filename stem; the first regex
# that matches AND passes its own plausibility check wins.
_FRAME_TIMESTAMP_PATTERNS: List[_FrameTimestampPattern] = [
    _FrameTimestampPattern(
        # KAMERA convention: YYYYMMDD[_-]HHMMSS with an optional fractional-second
        # suffix, e.g. kamera_calibration_fl02_C_20240407_130757.206341_ir.tif
        name='datestamp',
        regex=re.compile(
            r'(?<!\d)(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?:[.,](\d{1,6}))?(?!\d)'
        ),
        to_seconds=_datestamp_to_seconds,
    ),
    _FrameTimestampPattern(
        # bare epoch milliseconds, e.g. img_1719843225123.tif
        name='epoch-millis',
        regex=re.compile(r'(?<!\d)(\d{13})(?!\d)'),
        to_seconds=_epoch_millis_to_seconds,
    ),
    _FrameTimestampPattern(
        # bare epoch seconds, e.g. img_1719843225.tif
        name='epoch-seconds',
        regex=re.compile(r'(?<!\d)(\d{10})(?!\d)'),
        to_seconds=_epoch_seconds_to_seconds,
    ),
]


def parse_frame_timestamp(filename: str) -> Optional[float]:
    """
    Frame capture timestamp, in epoch seconds, parsed from a filename. Returns
    None (never raises) when no recognized convention matches; callers must
    treat that as "no timestamp available".
    """
    stem = Path(filename).stem
    for pattern in _FRAME_TIMESTAMP_PATTERNS:
        match = pattern.regex.search(stem)
        if match:
            seconds = pattern.to_seconds(match)
            if seconds is not None:
                return seconds
    return None
