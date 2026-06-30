from dive_utils.serializers.frame_metadata import (
    find_join_columns,
    normalize_key,
    parse_frame_metadata_source,
    select_frame_metadata_source,
)


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
