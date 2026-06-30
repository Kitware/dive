import json
from pathlib import Path

from dive_utils.serializers.frame_metadata import (
    find_join_columns,
    normalize_key,
    parse_frame_metadata_source,
    select_frame_metadata_source,
)


FIXTURE_DIR = (
    Path(__file__).resolve().parents[4] / "test-datasets" / "fixtures" / "frame-metadata"
)
CONTRACT_PATH = FIXTURE_DIR / "synthetic_auv_nav_expected.json"


def _load_contract():
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def _fixture_text(source_name):
    return (FIXTURE_DIR / source_name).read_text(encoding="utf-8")


def _media_keys(camera_records, join_column):
    return {
        normalize_key(record[join_column]): int(frame)
        for frame, record in camera_records.items()
    }


def _records_by_frame(source, media_keys):
    return {
        str(frame): source.records[key]
        for key, frame in sorted(media_keys.items(), key=lambda item: item[1])
        if key in source.records
    }


def _source_status(source):
    return "none" if source is None else "selected"


def test_normalize_key_matches_image_name_map_keys():
    assert normalize_key("nested/20191009.154056.00082_rect_color.tif") == (
        "20191009.154056.00082_rect_color"
    )


def test_parse_noaa_style_rows_with_multiple_image_columns():
    media_keys = {
        "20191009.154056.00082_rect_color": 0,
        "20191009.154056.00081_rect_color": 0,
    }
    text = """port_image date time latitude longitude water_depth altitude starboard_image
20191009.154056.00082_rect_color.tif 2019/10/09 15:40:56.1122 46.575870 -124.603094 192.80 2.78 20191009.154056.00081_rect_color.tif
"""

    source = parse_frame_metadata_source(text, media_keys, source_name="nav.txt")

    assert source is not None
    assert source.source_name == "nav.txt"
    assert source.header == [
        "port_image",
        "date",
        "time",
        "latitude",
        "longitude",
        "water_depth",
        "altitude",
        "starboard_image",
    ]
    assert source.join_columns == ["port_image", "starboard_image"]
    assert source.payload_columns == [
        "date",
        "time",
        "latitude",
        "longitude",
        "water_depth",
        "altitude",
    ]
    assert set(source.records) == {
        "20191009.154056.00082_rect_color",
        "20191009.154056.00081_rect_color",
    }
    port_record = source.records["20191009.154056.00082_rect_color"]
    assert list(port_record) == source.header
    assert port_record["latitude"] == "46.575870"
    assert all(isinstance(value, str) for value in port_record.values())


def test_parse_comma_tab_and_whitespace_delimited_sources():
    media_keys = {"image_0001": 0}

    for text in (
        "filename,depth,latitude\nimage_0001.jpg,192.80,46.575870\n",
        "filename\tdepth\tlatitude\nimage_0001.jpg\t192.80\t46.575870\n",
        "filename depth latitude\nimage_0001.jpg 192.80 46.575870\n",
    ):
        source = parse_frame_metadata_source(text, media_keys)

        assert source is not None
        assert source.header == ["filename", "depth", "latitude"]
        assert source.join_columns == ["filename"]
        assert source.records["image_0001"] == {
            "filename": "image_0001.jpg",
            "depth": "192.80",
            "latitude": "46.575870",
        }


def test_find_join_columns_matches_by_filename_value():
    rows = [
        {
            "port_image": "20191009.154056.00082_rect_color.tif",
            "latitude": "46.575870",
            "starboard_image": "20191009.154056.00081_rect_color.tif",
        }
    ]

    assert find_join_columns(
        ["port_image", "latitude", "starboard_image"],
        rows,
        {
            "20191009.154056.00082_rect_color": 0,
            "20191009.154056.00081_rect_color": 0,
        },
    ) == ["port_image", "starboard_image"]


def test_rejects_viame_annotation_csv_even_when_image_column_matches():
    media_keys = {"20191009.154056.00082_rect_color": 0}
    viame_csv = """# 1: Detection or Track-id,2: Video or Image Identifier,3: Unique Frame Identifier,4-7: Img-bbox(TL_x,TL_y,BR_x,BR_y),8: Detection or Length Confidence,9: Target Length (0 or -1 if invalid),10-11+: Repeated Species,Confidence Pairs or Attributes
1,20191009.154056.00082_rect_color.tif,0,0,0,10,10,1.0,-1,fish,0.9
"""

    assert parse_frame_metadata_source(viame_csv, media_keys) is None


def test_accepts_viame_shaped_telemetry_without_viame_header():
    """Telemetry whose rows coincidentally match VIAME's numeric shape but lacks the
    ``# 1: Detection or Track-id`` comment header is still accepted as telemetry."""
    media_keys = {"image_0001": 0}
    text = (
        "index,image,frame,x,y,depth,altitude,heading,temperature\n"
        "1,image_0001.jpg,100,46.5,-124.6,192.8,2.7,180.5,4.2\n"
    )

    source = parse_frame_metadata_source(text, media_keys)

    assert source is not None
    assert source.join_columns == ["image"]
    assert source.records["image_0001"]["depth"] == "192.8"


def test_rejects_bare_image_list_and_unrelated_text():
    media_keys = {"image_0001": 0}

    assert parse_frame_metadata_source("image\nimage_0001.jpg\n", media_keys) is None
    assert parse_frame_metadata_source("note,value\nhello,world\n", media_keys) is None


def test_select_source_rejects_ambiguous_candidates_and_non_text_extensions():
    media_keys = {"image_0001": 0}
    accepted_text = "filename,depth\nimage_0001.jpg,192.80\n"

    assert (
        select_frame_metadata_source(
            [
                ("metadata.json", accepted_text),
                ("telemetry-a.txt", accepted_text),
            ],
            media_keys,
        ).source_name
        == "telemetry-a.txt"
    )
    assert (
        select_frame_metadata_source(
            [
                ("telemetry-a.txt", accepted_text),
                ("telemetry-b.csv", "filename,temperature\nimage_0001.jpg,4.2\n"),
            ],
            media_keys,
        )
        is None
    )


def test_shared_synthetic_auv_fixture_contract():
    contract = _load_contract()

    for source_name, expected in contract["sources"].items():
        text = _fixture_text(source_name)
        for camera, camera_contract in expected["cameras"].items():
            expected_records = {
                frame: expected["recordsByFrame"][frame]
                for frame in camera_contract["frames"]
            }
            join_column = camera_contract["joinColumn"]
            media_keys = _media_keys(expected_records, join_column)

            source = parse_frame_metadata_source(text, media_keys, source_name=source_name)

            assert source is not None
            assert source.source_name == source_name
            assert source.header == expected["header"]
            assert source.join_columns == [join_column]
            assert source.payload_columns == camera_contract["payloadColumns"]
            assert _records_by_frame(source, media_keys) == expected_records
            assert all(
                isinstance(value, str)
                for record in source.records.values()
                for value in record.values()
            )


def test_shared_synthetic_auv_selection_status_contract():
    contract = _load_contract()
    source_contract = contract["sources"]["synthetic_auv_nav_rect.txt"]
    port_contract = source_contract["cameras"]["port"]
    port_records = {
        frame: source_contract["recordsByFrame"][frame]
        for frame in port_contract["frames"]
    }
    media_keys = _media_keys(port_records, port_contract["joinColumn"])
    rect_text = _fixture_text("synthetic_auv_nav_rect.txt")

    missing_source = select_frame_metadata_source(
        [("synthetic_auv_nav_jpg.txt", _fixture_text("synthetic_auv_nav_jpg.txt"))],
        media_keys,
    )
    ambiguous_source = select_frame_metadata_source(
        [
            ("synthetic_auv_nav_rect.txt", rect_text),
            ("synthetic_auv_nav_rect_copy.csv", rect_text),
        ],
        media_keys,
    )

    assert {
        "missing": _source_status(missing_source),
        "ambiguous": _source_status(ambiguous_source),
    } == contract["selectionStatus"]
