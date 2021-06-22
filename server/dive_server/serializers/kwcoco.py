"""
KWCOCO JSON format deserializer
"""
import json
from typing import Any, Dict, List, Tuple

from dive_server.serializers import viame
from dive_utils.models import Attribute, CocoMetadata, Feature, Track


def is_coco_json(coco: Dict[str, Any]):
    keys = ['categories', 'keypoint_categories', 'images', 'videos', 'annotations']
    return any(key in coco for key in keys)


def annotation_info(
    annotation: dict, meta: CocoMetadata
) -> Tuple[int, str, int, List[int]]:
    annotation_id = annotation['id']
    image_id = annotation['image_id']
    filename = meta.images[image_id]['file_name']

    # may not exist, fall back to default values
    trackId = annotation.get('track_id', annotation_id)
    frame = meta.images[image_id].get('frame_index', image_id)

    bounds = annotation['bbox']
    # update from width/height to bottom right corner point
    bounds[2] += bounds[0]
    bounds[3] += bounds[1]

    return trackId, filename, frame, bounds


def _parse_annotation(
    annotation: dict, meta: CocoMetadata
) -> Tuple[dict, dict, dict, list]:
    features: Dict[str, Any] = {}
    attributes: Dict[str, Any] = {}
    track_attributes: Dict[str, Any] = {}

    category_id = annotation['category_id']
    score = annotation.get('score', 1.0)  # may not exit, default to 1.0
    class_name = meta.categories[category_id]['name']
    confidence_pair = (class_name, score)

    # parse keypoints
    keypoints = annotation.get('keypoints', [])
    head_tail = []
    for keypoint in keypoints:
        if type(keypoint) is not dict:  # [x1, y1, v1, ...] coco format
            keypoint_labels = meta.categories[category_id].get('keypoints', [])
            n = min(len(keypoint_labels), int(len(keypoints) / 3)) # stopping index
            for i in range(n):
                point = keypoints[3 * i:3 * i + 2] # [x, y] pair
                label = keypoint_labels[i]
                if label in ('head', 'tail'):  # only allow head and tail keypoints
                    head_tail.append(point)
                    viame.create_geoJSONFeature(features, 'Point', point, label)
            break

        # dictionary kwcoco format
        keypoint_category_id = keypoint['keypoint_category_id']
        label = meta.keypoint_categories[keypoint_category_id]['name']
        point = keypoint['xy']
        if label in ('head', 'tail'):  # only allow head and tail keypoints
            head_tail.append(keypoint['xy'])
            viame.create_geoJSONFeature(features, 'Point', point, label)
    
    # create head-tail line if keypoint pair exists
    if len(head_tail) > 2:
        raise ValueError("Multiple head/tail keypoints per annotation not supported")
    elif len(head_tail) == 2:
        viame.create_geoJSONFeature(features, 'LineString', head_tail, 'HeadTails')

    # parse polygons
    segmentation = annotation.get('segmentation', [])
    rle = bool(annotation.get('iscrowd', False)) or type(segmentation) is dict
    
    if segmentation:
        if rle:  # run-length encoding polygon 
            raise ValueError('Run-Length Encoding not supported')
        else:  # standard coordinates polygon
            if len(segmentation) > 1:
                raise ValueError("Multiple polygons per annotation not supported")
            polygon = segmentation[0]
            if type(polygon) is dict:  # dictionary kwcoco format
                coords = polygon.get('exterior', [])
                hole = polygon.get('interior', [])
                if hole:
                    raise ValueError("Polygon with hole not supported")
            elif type(polygon) is list:  # list coco format
                coords = list(zip(polygon[::2], polygon[1::2]))
            else:
                raise ValueError("Incorrect polygon segmentation")

            if coords:
                viame.create_geoJSONFeature(features, 'Polygon', coords)

    # TODO: process attributes and track_attributes

    return features, attributes, track_attributes, [confidence_pair]


def _parse_annotation_for_tracks(
    annotation: dict, meta: CocoMetadata
) -> Tuple[Feature, dict, dict, list]:
    (
        features,
        attributes,
        track_attributes,
        confidence_pairs,
    ) = _parse_annotation(annotation, meta)
    trackId, filename, frame, bounds = annotation_info(annotation, meta)

    feature = Feature(
        frame=frame,
        bounds=bounds,
        attributes=attributes or None,
        fishLength=None,
        **features,
    )

    # Pass the rest of the unchanged info through as well
    return feature, attributes, track_attributes, confidence_pairs


def load_coco_metadata(coco: Dict[str, List[dict]]) -> CocoMetadata:
    categories = {x['id']: x for x in coco.get('categories', [])}
    keypoint_categories = {x['id']: x for x in coco.get('keypoint_categories', [])}
    images = {x['id']: x for x in coco.get('images', [])}
    videos = {x['id']: x for x in coco.get('videos', [])}
    return CocoMetadata(
        categories=categories,
        keypoint_categories=keypoint_categories,
        images=images,
        videos=videos,
    )


def load_coco_as_tracks_and_attributes(
    coco: Dict[str, List[dict]]
) -> Tuple[dict, dict]:
    """
    Convert KWCOCO json to DIVE json tracks.
    """
    tracks: Dict[int, Track] = {}
    metadata_attributes: Dict[str, Attribute] = {}
    test_vals: Dict[str, int] = {}
    meta = load_coco_metadata(coco)
    annotations = coco.get('annotations', [])

    for annotation in annotations:
        (
            feature,
            attributes,
            track_attributes,
            confidence_pairs,
        ) = _parse_annotation_for_tracks(annotation, meta)

        trackId, _, frame, _ = annotation_info(annotation, meta)

        if trackId not in tracks:
            tracks[trackId] = Track(begin=frame, end=frame, trackId=trackId)

        track = tracks[trackId]
        track.begin = min(frame, track.begin)
        track.end = max(track.end, frame)
        track.features.append(feature)
        track.confidencePairs = confidence_pairs

        # TODO: process attributes and track_attributes

    track_json = {
        trackId: track.dict(exclude_none=True) for trackId, track in tracks.items()
    }
    return track_json, metadata_attributes
