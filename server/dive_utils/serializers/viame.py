"""
VIAME Fish format deserializer
"""
import csv
import datetime
import io
import json
import os
import re
from typing import Any, Dict, Generator, List, Tuple, Union

from dive_utils import constants, models, types
from dive_utils.models import Feature, Track, interpolate


def format_timestamp(fps: int, frame: int) -> str:
    return str(datetime.datetime.utcfromtimestamp(frame / fps).strftime(r'%H:%M:%S.%f'))


def writeHeader(writer: 'csv._writer', metadata: Dict):  # type: ignore
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


def create_geoJSONFeature(features: Dict[str, Any], type: str, coords: List[Any], key=''):
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
    if type == 'Polygon':
        feature["geometry"]['coordinates'] = [coords]
    elif type in ["LineString", "Point"]:
        feature['geometry']['coordinates'] = coords

    features['geometry']['features'].append(feature)


def _parse_row(row: List[str]) -> Tuple[Dict, Dict, Dict, List]:
    """
    Parse a single CSV line into its composite track and detection parts
    """
    features: Dict[str, Any] = {}
    attributes: Dict[str, Any] = {}
    track_attributes: Dict[str, Any] = {}
    confidence_pairs: List[Tuple[str, float]] = [
        (row[i], float(row[i + 1]))
        for i in range(9, len(row), 2)
        if i + 1 < len(row) and row[i] and row[i + 1] and not row[i].startswith("(")
    ]
    sorted_confidence_pairs = sorted(confidence_pairs, key=lambda item: item[1], reverse=True)
    head_tail = []
    start = 9 + len(sorted_confidence_pairs) * 2

    for j in range(start, len(row)):
        # (kp) head x y
        head_regex = re.match(r"^\(kp\) head (-?[0-9]+\.*-?[0-9]*) (-?[0-9]+\.*-?[0-9]*)", row[j])
        if head_regex:
            point = [float(head_regex[1]), float(head_regex[2])]
            head_tail.append(point)
            create_geoJSONFeature(features, 'Point', point, 'head')

        # (kp) tail x y
        tail_regex = re.match(r"^\(kp\) tail (-?[0-9]+\.*-?[0-9]*) (-?[0-9]+\.*-?[0-9]*)", row[j])
        if tail_regex:
            point = [float(tail_regex[1]), float(tail_regex[2])]
            head_tail.append(point)
            create_geoJSONFeature(features, 'Point', point, 'tail')

        # (atr) text
        atr_regex = re.match(r"^\(atr\) (.*?)\s(.+)", row[j])
        if atr_regex:
            attributes[atr_regex[1]] = _deduceType(atr_regex[2])

        # (trk-atr) text
        trk_regex = re.match(r"^\(trk-atr\) (.*?)\s(.+)", row[j])
        if trk_regex:
            track_attributes[trk_regex[1]] = _deduceType(trk_regex[2])

        # (poly) x1 y1 x2 y2 ...
        poly_regex = re.match(r"^(\(poly\)) ((?:-?[0-9]+\.*-?[0-9]*\s*)+)", row[j])
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
        sorted_confidence_pairs.append(('unknown', confidence))

    return features, attributes, track_attributes, sorted_confidence_pairs


def _parse_row_for_tracks(row: List[str]) -> Tuple[Feature, Dict, Dict, List]:
    head_tail_feature, attributes, track_attributes, confidence_pairs = _parse_row(row)
    _, _, frame, bounds, fishLength = row_info(row)

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
    metadata_attributes: Dict[str, Dict[str, Any]],
    test_vals: Dict[str, Dict[str, int]],
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
    metadata_attributes: Dict[str, Dict[str, Any]], test_vals: Dict[str, Dict[str, int]]
):
    # count all keys must have a value to convert to predefined
    predefined_min_count = 3
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


def load_csv_as_tracks_and_attributes(
    rows: List[str], imageMap: Dict[str, int] = None
) -> Tuple[types.DIVEAnnotationSchema, dict]:
    """
    Convert VIAME CSV to json tracks

    :param rows: string rows of a VIAME CSV file
    :param imageMap: map of image names to frame numbers.  keys do NOT include file extension
    """
    reader = csv.reader(row for row in rows)
    tracks: Dict[int, Track] = {}
    metadata_attributes: Dict[str, Dict[str, Any]] = {}
    test_vals: Dict[str, Dict[str, int]] = {}
    reordered = False
    anyImageMatched = False
    missingImages: List[str] = []
    for row in reader:
        if len(row) == 0 or row[0].startswith('#'):
            # This is not a data row
            continue
        (
            feature,
            attributes,
            track_attributes,
            confidence_pairs,
        ) = _parse_row_for_tracks(row)

        trackId, imageFile, _, _, _ = row_info(row)

        if imageMap:
            # validate image ordering if the imageMap is provided
            imageName, _ = os.path.splitext(os.path.basename(imageFile))
            expectedFrameNumber = imageMap.get(imageName)
            if expectedFrameNumber is None:
                missingImages.append(imageFile)
            elif expectedFrameNumber != feature.frame:
                # force reorder the annotations
                reordered = True
                anyImageMatched = True
                feature.frame = expectedFrameNumber
            else:
                anyImageMatched = True

        if trackId not in tracks:
            tracks[trackId] = Track(begin=feature.frame, end=feature.frame, id=trackId)
        elif reordered:
            # trackId was already in tracks, so the track consists of multiple frames
            raise ValueError(
                (
                    'images were provided in an unexpected order '
                    'and dataset contains multi-frame tracks. '
                )
            )

        track = tracks[trackId]
        track.begin = min(feature.frame, track.begin)
        track.end = max(track.end, feature.frame)
        track.features.append(feature)
        track.confidencePairs = confidence_pairs

        for (key, val) in track_attributes.items():
            track.attributes[key] = val
            create_attributes(metadata_attributes, test_vals, 'track', key, val)
        for (key, val) in attributes.items():
            create_attributes(metadata_attributes, test_vals, 'detection', key, val)

    trackarr = tracks.items()

    if imageMap and len(missingImages) and anyImageMatched:
        examples = ', '.join(missingImages[:3])
        raise ValueError(
            ' '.join(
                [
                    'CSV import was found to have a mix of missing images and images that',
                    'were found in the data. This usually indicates a problem with the',
                    'annotation file, but if you want to force the import to proceed, you',
                    'can set all values in the Image Name column to be blank.  Then DIVE',
                    'will not attempt to validate image names.',
                    f'Missing images include: {examples}...',
                ]
            )
        )
    # Now we process all the metadata_attributes for the types
    calculate_attribute_types(metadata_attributes, test_vals)
    annotations: types.DIVEAnnotationSchema = {
        'tracks': {str(trackId): track.dict(exclude_none=True) for trackId, track in trackarr},
        'groups': {},
        'version': constants.AnnotationsCurrentVersion,
    }
    return annotations, models.MetadataMutable(attributes=metadata_attributes).dict(
        exclude_none=True
    )


def export_tracks_as_csv(
    track_iterator,
    excludeBelowThreshold=False,
    thresholds=None,
    filenames=None,
    fps=None,
    header=True,
    typeFilter=None,
    revision=None,
) -> Generator[str, None, None]:
    """
    Export track json to a CSV format.

    :param excludeBelowThreshold: omit tracks below a certain confidence.  Requires thresholds.
    :param thresholds: key/value pairs with threshold values
    :param filenames: list of string file names.  filenames[n] should be the image at frame n
    :param fps: if FPS is set, column 2 will be video timestamp derived from (frame / fps)
    :param header: include or omit header
    :param typeFilter: set of track types to only export if not empty
    """
    if thresholds is None:
        thresholds = {}
    if typeFilter is None:
        typeFilter = set()

    csvFile = io.StringIO()
    writer = csv.writer(csvFile)
    if header:
        metadata = {}
        if fps is not None:
            metadata["fps"] = fps
        if revision is not None:
            metadata["revision"] = revision
        writeHeader(writer, metadata)

    for t in track_iterator:
        track = Track(**t)
        if (not excludeBelowThreshold) or track.exceeds_thresholds(thresholds):

            # filter by types if applicable
            if typeFilter:
                confidence_pairs = [item for item in track.confidencePairs if item[0] in typeFilter]
                # skip line if no confidence pairs
                if not confidence_pairs:
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
                        track.id,
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

                    if feature.geometry and "FeatureCollection" == feature.geometry.type:
                        for geoJSONFeature in feature.geometry.features:
                            if 'Polygon' == geoJSONFeature.geometry.type:
                                # Coordinates need to be flattened out from their list of tuples
                                coordinates = [
                                    item
                                    for sublist in geoJSONFeature.geometry.coordinates[
                                        0
                                    ]  # type: ignore
                                    for item in sublist  # type: ignore
                                ]
                                columns.append(
                                    f"(poly) {' '.join(map(lambda x: str(round(x)), coordinates))}"
                                )
                            if 'Point' == geoJSONFeature.geometry.type:
                                coordinates = geoJSONFeature.geometry.coordinates  # type: ignore
                                columns.append(
                                    f"(kp) {geoJSONFeature.properties['key']} "
                                    f"{round(coordinates[0])} {round(coordinates[1])}"
                                )
                            # TODO: support for multiple GeoJSON Objects of the same type
                            # once the CSV supports it

                    writer.writerow(columns)
                    yield csvFile.getvalue()
                    csvFile.seek(0)
                    csvFile.truncate(0)
    yield csvFile.getvalue()
