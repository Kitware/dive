"""
VIAME Fish format deserializer
"""
import csv
import datetime
import io
import json
import re
from typing import Dict, Generator, List, Tuple, Union

from dive_utils.models import Attribute, Feature, Track, interpolate


def format_timestamp(fps: int, frame: int) -> str:
    return str(datetime.datetime.utcfromtimestamp(frame / fps).strftime(r'%H:%M:%S.%f'))


def writeHeader(writer: '_csv._writer', metadata: Dict):
    writer.writerow(
        [
            "# 1: Detection or Track-id",
            "2: Video or Image Identifier",
            "3: Unique Frame Identifier",
            "4-7: Img-bbox(TL_x",
            "TL_y",
            "BR_x",
            "BR_y)",
            "8: Detection or Length Confidence",
            "9: Target Length (0 or -1 if invalid)",
            "10-11+: Repeated Species",
            "Confidence Pairs or Attributes",
        ]
    )
    metadata_dict = {}
    metadata_dict.update(metadata)
    metadata_dict['exported_by'] = 'dive:python'
    metadata_dict['exported_time'] = datetime.datetime.now().ctime()
    metadata_list = []
    for (key, value) in metadata_dict.items():
        metadata_list.append(f"{key}: {json.dumps(value)}")
    writer.writerow(['# metadata', *metadata_list])


def valueToString(value):
    if value is True:
        return "true"
    elif value is False:
        return "false"
    return str(value)


def row_info(row: List[str]) -> Tuple[int, str, int, List[int], float]:
    trackId = int(row[0])
    filename = str(row[1])
    frame = int(row[2])

    bounds = [round(float(x)) for x in row[3:7]]
    fish_length = float(row[8])

    return trackId, filename, frame, bounds, fish_length


def _deduceType(value: str) -> Union[bool, float, str]:
    if value == "true":
        return True
    if value == "false":
        return False
    try:
        number = float(value)
        return number
    except ValueError:
        return value


def create_geoJSONFeature(features: Feature, type: str, coords: List[float], key=''):
    feature = {}
    if "geometry" not in features:
        features["geometry"] = {"type": "FeatureCollection", "features": []}
    else:  # check for existing type/key pairs
        if features["geometry"]["features"]:
            for subfeature in features["geometry"]["features"]:
                if (
                    subfeature["geometry"]["type"] == type
                    and subfeature["properties"]["key"] == key
                ):
                    feature = subfeature
                    break
    if "geometry" not in feature:
        feature = {
            "type": "Feature",
            "properties": {"key": key},
            "geometry": {"type": type},
        }
    if "Polygon" == type:
        feature["geometry"]['coordinates'] = [coords]
    elif type in ["LineString", "Point"]:
        feature['geometry']['coordinates'] = coords

    features['geometry']['features'].append(feature)


def _parse_row(row: List[str]) -> Tuple[Dict, Dict, Dict, List]:
    """
    parse a single CSV line into its composite track and detection parts
    """
    features = {}
    attributes = {}
    track_attributes = {}
    confidence_pairs = [
        [row[i], float(row[i + 1])]
        for i in range(9, len(row), 2)
        if i + 1 < len(row) and row[i] and row[i + 1] and not row[i].startswith("(")
    ]
    sorted_confidence_pairs = sorted(
        confidence_pairs, key=lambda item: item[1], reverse=True
    )
    head_tail = []
    start = 9 + len(sorted_confidence_pairs) * 2

    for j in range(start, len(row)):
        head_regex = re.match(
            r"^\(kp\) head ([0-9]+\.*[0-9]*) ([0-9]+\.*[0-9]*)", row[j]
        )
        if head_regex:
            head_tail.insert(0, [float(head_regex[1]), float(head_regex[2])])
            create_geoJSONFeature(features, 'Point', head_tail[0], 'head')
        tail_regex = re.match(
            r"^\(kp\) tail ([0-9]+\.*[0-9]*) ([0-9]+\.*[0-9]*)", row[j]
        )
        if tail_regex:
            head_tail.insert(1, [float(tail_regex[1]), float(tail_regex[2])])
            create_geoJSONFeature(
                features, 'Point', head_tail[len(head_tail) - 1], 'tail'
            )
        atr_regex = re.match(r"^\(atr\) (.*?)\s(.+)", row[j])
        if atr_regex:
            attributes[atr_regex[1]] = _deduceType(atr_regex[2])
        trk_regex = re.match(r"^\(trk-atr\) (.*?)\s(.+)", row[j])
        if trk_regex:
            track_attributes[trk_regex[1]] = _deduceType(trk_regex[2])
        poly_regex = re.match(r"^(\(poly\)) ((?:[0-9]+\.*[0-9]*\s*)+)", row[j])
        if poly_regex:
            temp = [float(x) for x in poly_regex[2].split()]
            coords = list(zip(temp[::2], temp[1::2]))
            create_geoJSONFeature(features, 'Polygon', coords)

    if len(head_tail) == 2:
        create_geoJSONFeature(features, 'LineString', head_tail, 'HeadTails')

    # ensure confidence pairs list is not empty
    if len(sorted_confidence_pairs) == 0:
        # extract Detection or Length Confidence field
        try:
            confidence = float(row[7])
        except ValueError:  # in case field is empty
            confidence = 1.0

        # add a dummy pair with a default type
        sorted_confidence_pairs.append(['unknown', confidence])

    return features, attributes, track_attributes, sorted_confidence_pairs


def _parse_row_for_tracks(row: List[str]) -> Tuple[Feature, Dict, Dict, List]:
    head_tail_feature, attributes, track_attributes, confidence_pairs = _parse_row(row)
    trackId, filename, frame, bounds, fishLength = row_info(row)

    feature = Feature(
        frame=frame,
        bounds=bounds,
        attributes=attributes or None,
        fishLength=fishLength if fishLength > 0 else None,
        **head_tail_feature,
    )

    # Pass the rest of the unchanged info through as well
    return feature, attributes, track_attributes, confidence_pairs


def create_attributes(
    metadata_attributes: Dict[str, Attribute],
    test_vals: Dict[str, int],
    atr_type: str,
    key: str,
    val,
):
    valstring = f'{val}'
    attribute_key = f'{atr_type}_{key}'
    if attribute_key not in metadata_attributes:
        metadata_attributes[attribute_key] = {
            'belongs': atr_type,
            'datatype': 'text',
            'name': key,
            'key': attribute_key,
        }
        test_vals[attribute_key] = {}
        test_vals[attribute_key][valstring] = 1
    elif attribute_key in metadata_attributes and attribute_key in test_vals:
        if valstring in test_vals[attribute_key]:
            test_vals[attribute_key][valstring] += 1
        else:
            test_vals[attribute_key][valstring] = 1


def calculate_attribute_types(
    metadata_attributes: Dict[str, Attribute], test_vals: Dict[str, int]
):
    predefined_min_count = (
        3  # count all keys must have a value to convert to predefined
    )
    for attributeKey in metadata_attributes.keys():
        if attributeKey in test_vals:
            attribute_type = 'number'
            low_count = predefined_min_count
            values = []
            for (key, val) in test_vals[attributeKey].items():
                if val <= low_count:
                    low_count = val
                values.append(key)
                if attribute_type == 'number':
                    try:
                        float(key)
                    except ValueError:
                        attribute_type = 'boolean'
                if attribute_type == 'boolean' and key != 'True' and key != 'False':
                    attribute_type = 'text'
            # If all text values are used 3 or more times they are defined values
            if low_count >= predefined_min_count and 'text' in attribute_type:
                metadata_attributes[attributeKey]['values'] = values

            metadata_attributes[attributeKey]['datatype'] = attribute_type


def load_csv_as_tracks_and_attributes(rows: List[str]) -> Tuple[dict, dict]:
    """
    Convert VIAME CSV to json tracks.
    Expect detections to be in increasing order (either globally or by track).
    """
    reader = csv.reader(row for row in rows if (not row.startswith("#") and row))
    tracks: Dict[int, Track] = {}
    metadata_attributes: Dict[str, Attribute] = {}
    test_vals = {}
    for row in reader:
        (
            feature,
            attributes,
            track_attributes,
            confidence_pairs,
        ) = _parse_row_for_tracks(row)

        trackId, _, frame, _, _ = row_info(row)

        if trackId not in tracks:
            tracks[trackId] = Track(begin=frame, end=frame, trackId=trackId)

        track = tracks[trackId]
        track.begin = min(frame, track.begin)
        track.end = max(track.end, frame)
        track.features.append(feature)
        track.confidencePairs = confidence_pairs

        for (key, val) in track_attributes.items():
            track.attributes[key] = val
            create_attributes(metadata_attributes, test_vals, 'track', key, val)
        for (key, val) in attributes.items():
            create_attributes(metadata_attributes, test_vals, 'detection', key, val)
    # Now we process all the metadata_attributes for the types
    calculate_attribute_types(metadata_attributes, test_vals)

    track_json = {
        trackId: track.dict(exclude_none=True) for trackId, track in tracks.items()
    }
    return track_json, metadata_attributes


def export_tracks_as_csv(
    track_dict,
    excludeBelowThreshold=False,
    thresholds={},
    filenames=None,
    fps=None,
    header=True,
    filterByTypes=False,
    typeFilter=set(),
) -> Generator[str, None, None]:
    """Export track json to a CSV format.
    :excludeBelowThreshold: omit tracks below a certain confidence.  Requires thresholds.

    :thresholds: key/value paris with threshold values

    :filenames: list of string file names.  filenames[n] should be the image at frame n

    :fps: if FPS is set, column 2 will be video timestamp derived from (frame / fps)

    :header: include or omit header

    :filterByTypes: omit tracks not of specified types.  Requires typeFilter

    :typeFilter: set of track types to only export
    """
    csvFile = io.StringIO()
    writer = csv.writer(csvFile)
    if header:
        metadata = {}
        if fps is not None:
            metadata["fps"] = fps
        writeHeader(writer, metadata)
    for t in track_dict.values():
        track = Track(**t)
        if (not excludeBelowThreshold) or track.exceeds_thresholds(thresholds):

            # filter by types if applicable
            if filterByTypes:
                confidence_pairs = [
                    item for item in track.confidencePairs if item[0] in typeFilter
                ]
                # skip line if no confidence pairs
                if len(confidence_pairs) == 0:
                    continue
            else:
                confidence_pairs = track.confidencePairs

            sorted_confidence_pairs = sorted(
                confidence_pairs, key=lambda item: item[1], reverse=True
            )

            for index, keyframe in enumerate(track.features):
                features = [keyframe]

                # If this is not the last keyframe, and interpolation is
                # enabled for this keyframe, interpolate
                if keyframe.interpolate and index < len(track.features) - 1:
                    nextKeyframe = track.features[index + 1]
                    # interpolate all features in [a,b)
                    features = interpolate(keyframe, nextKeyframe)

                for feature in features:
                    columns = [
                        track.trackId,
                        "",
                        feature.frame,
                        *feature.bounds,
                        sorted_confidence_pairs[0][1],
                        feature.fishLength or -1,
                    ]

                    # If FPS is set, column 2 will be video timestamp
                    if fps is not None and fps > 0:
                        columns[1] = format_timestamp(fps, feature.frame)
                    # else if filenames is set, column 2 will be image file name
                    elif filenames and feature.frame < len(filenames):
                        columns[1] = filenames[feature.frame]

                    for pair in sorted_confidence_pairs:
                        columns.extend(list(pair))

                    if feature.attributes:
                        for key, val in feature.attributes.items():
                            columns.append(f"(atr) {key} {valueToString(val)}")

                    if track.attributes:
                        for key, val in track.attributes.items():
                            columns.append(f"(trk-atr) {key} {valueToString(val)}")

                    if (
                        feature.geometry
                        and "FeatureCollection" == feature.geometry.type
                    ):
                        for geoJSONFeature in feature.geometry.features:
                            if 'Polygon' == geoJSONFeature.geometry.type:
                                # Coordinates need to be flattened out from their list of tuples
                                coordinates = [
                                    item
                                    for sublist in geoJSONFeature.geometry.coordinates[
                                        0
                                    ]
                                    for item in sublist
                                ]
                                columns.append(
                                    f"(poly) {' '.join(map(lambda x: str(round(x)), coordinates))}"
                                )
                            if 'Point' == geoJSONFeature.geometry.type:
                                coordinates = geoJSONFeature.geometry.coordinates
                                columns.append(
                                    f"(kp) {geoJSONFeature.properties['key']} {round(coordinates[0])} {round(coordinates[1])}"
                                )
                            # TODO: support for multiple GeoJSON Objects of the same type once the CSV supports it

                    writer.writerow(columns)
                    yield csvFile.getvalue()
                    csvFile.seek(0)
                    csvFile.truncate(0)
