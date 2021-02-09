"""
VIAME Fish format deserializer
"""
import csv
import datetime
import io
import re
from typing import Dict, Generator, List, Tuple, Union

from viame_server.serializers.models import Feature, Track, interpolate


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
    metadata_list = []
    for (key, value) in metadata.items():
        metadata_list.append(f" {key}: {value}")
    metadata_str = ",".join(metadata_list)
    writer.writerow([f'# metadata -{metadata_str}'])

    writer.writerow([f'# Written on {datetime.datetime.now().ctime()} by: dive:python'])


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


def load_csv_as_tracks(rows: List[str]) -> Dict[str, dict]:
    """
    Convert VIAME CSV to json tracks.
    Expect detections to be in increasing order (either globally or by track).
    """
    reader = csv.reader(row for row in rows if (not row.startswith("#") and row))
    tracks: Dict[int, Track] = {}
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

    return {trackId: track.dict(exclude_none=True) for trackId, track in tracks.items()}


def export_tracks_as_csv(
    track_dict,
    excludeBelowThreshold=False,
    thresholds={},
    filenames=None,
    fps=None,
    header=True,
) -> Generator[str, None, None]:
    """Export track json to a CSV format.
    :exlcudeBelowThreshold: omit tracks below a certain confidence.  Requires thresholds.

    :thresholds: key/value paris with threshold values

    :filenames: list of string file names.  filenames[n] should be the image at frame n

    :fps: if FPS is set, column 2 will be video timestamp derived from (frame / fps)

    :header: include or omit header
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

            sorted_confidence_pairs = sorted(
                track.confidencePairs, key=lambda item: item[1], reverse=True
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
                        columns[1] = datetime.datetime.utcfromtimestamp(
                            feature.frame / fps
                        ).strftime(r'%H:%M:%S.%f')
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
