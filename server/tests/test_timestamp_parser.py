import pytest

from dive_utils import timestamp_parser


def test_parses_datestamp():
    assert timestamp_parser.parse_frame_timestamp('left_20230615_143022.png') == 1686839422.0


def test_parses_datestamp_with_fractional_seconds():
    assert timestamp_parser.parse_frame_timestamp('left_20230615_143022.500.png') == pytest.approx(
        1686839422.5
    )


def test_parses_bare_epoch_millis():
    assert timestamp_parser.parse_frame_timestamp('img_1719843225123.tif') == pytest.approx(
        1719843225.123
    )


def test_parses_bare_epoch_seconds():
    assert timestamp_parser.parse_frame_timestamp('img_1719843225.tif') == 1719843225.0


def test_returns_none_for_plain_sequential_filename():
    assert timestamp_parser.parse_frame_timestamp('img_00001.png') is None


def test_returns_none_for_short_frame_counter_filename():
    assert timestamp_parser.parse_frame_timestamp('frame042.tif') is None


def test_returns_none_for_implausible_range_digit_run():
    assert timestamp_parser.parse_frame_timestamp('img_0000000001.png') is None


def test_is_extension_agnostic():
    tif = timestamp_parser.parse_frame_timestamp('left_20230615_143022.tif')
    png = timestamp_parser.parse_frame_timestamp('left_20230615_143022.png')
    assert tif == png
