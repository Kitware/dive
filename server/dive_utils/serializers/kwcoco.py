"""
KWCOCO JSON format deserializer
"""
import functools
from typing import Any, Dict, List, Tuple

from dive_utils import constants, models, strNumericCompare, types
from dive_utils.models import CocoMetadata, Feature, Track

from . import viame


def is_coco_json(coco: Dict[str, Any]):
    # Required COCO fields according to https://cocodataset.org/#format-data
    keys = ['info', 'images', 'annotations', 'categories']
    return all(key in coco for key in keys)


def annotation_info(annotation: dict, meta: CocoMetadata) -> Tuple[int, str, int, List[int]]:
    # these fields will always exist
    annotation_id = annotation['id']
    image_id = annotation['image_id']
    filename = meta.images[image_id]['file_name']
    frame = meta.images[image_id]['frame_index']

    # track ID may not exist so use annotation ID as replacement
    # track ID may be of type int, string, UUID
    # handle int and string types, throw error on UUID
    trackId = int(annotation.get('track_id', annotation_id))

    bounds = annotation['bbox']
    # update from [TL_x, TL_y, width, height] to [TL_x, TL_y, BR_x, BR_y]
    bounds[2] += bounds[0]
    bounds[3] += bounds[1]

    return trackId, filename, frame, bounds


def _parse_annotation(annotation: dict, meta: CocoMetadata) -> Tuple[dict, dict, dict, list]:
    """
    Parse a single KWCOCO annotation into its composite track and detection parts
    """
    features: Dict[str, Any] = {}
    attributes: Dict[str, Any] = {}
    track_attributes: Dict[str, Any] = {}

    category_id = annotation['category_id']
    score = annotation.get('score', 1.0)  # may not exist, default to 1.0
    class_name = meta.categories[category_id]['name']
    confidence_pair = (class_name, score)

    # parse keypoints
    keypoints = annotation.get('keypoints', [])
    head_tail = []
    for keypoint in keypoints:
        if isinstance(keypoint, (int, float)):  # [x1, y1, v1, ...] coco format
            keypoint_labels = meta.categories[category_id].get('keypoints', [])
            n = min(len(keypoint_labels), int(len(keypoints) / 3))  # stopping index
            for i in range(n):
                point = keypoints[3 * i : 3 * i + 2]  # extract [x, y] pair
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
        raise ValueError('Multiple head/tail keypoints per annotation not supported')
    elif len(head_tail) == 2:
        viame.create_geoJSONFeature(features, 'LineString', head_tail, 'HeadTails')

    # parse polygons
    segmentation = annotation.get('segmentation', [])
    rle = bool(annotation.get('iscrowd', False)) or isinstance(segmentation, dict)

    if rle:  # run-length encoding polygon
        raise ValueError('Run-Length Encoding not supported')

    if segmentation:
        if rle:  # run-length encoding polygon
            raise ValueError('Run-Length Encoding not supported')
        else:  # standard coordinates polygon
            # expected [[x1, y1, ...], [x1, y1, ...], ...] standard format

            if len(segmentation) > 1:
                if isinstance(segmentation[0], (int, float)):
                    # received [x1, y1, ...] format
                    polygon = segmentation
                else:
                    polygon = segmentation[0]
            else:
                polygon = segmentation[0]  # get first polygon only

            if isinstance(polygon, dict):  # dictionary kwcoco format
                coords = polygon.get('exterior', [])
            elif isinstance(polygon, list):  # list coco format
                coords = list(zip(polygon[::2], polygon[1::2]))
            else:
                raise ValueError('Incorrect polygon segmentation')

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
    categories = coco.get('categories', [])
    keypoint_categories = coco.get('keypoint_categories', [])
    images = coco.get('images', [])
    videos = coco.get('videos', [])
    annotations = coco.get('annotations', [])

    # check if annotations have track IDs
    has_track_id = annotations and 'track_id' in annotations[0]
    # if any videos exist, can assume the images have frame indices
    is_video = len(videos) > 0

    def file_name_cmp(item1, item2):
        return strNumericCompare(item1['file_name'], item2['file_name'])

    # sort images by "dive order"
    dive_sorted_images = sorted(images, key=functools.cmp_to_key(file_name_cmp))

    # assign frame_index to all images
    for i, image in enumerate(dive_sorted_images):
        if 'frame_index' not in image:
            image['frame_index'] = i

    if not is_video and has_track_id:  # sort order matters
        # sort images by frame_index
        frame_sorted_images = sorted(dive_sorted_images, key=lambda x: x['frame_index'])

        if frame_sorted_images != dive_sorted_images:
            raise ValueError('Image track IDs exists and frame index do not match DIVE sort order')

    categories_map = {x['id']: x for x in categories}
    keypoint_categories_map = {x['id']: x for x in keypoint_categories}
    images_map = {x['id']: x for x in dive_sorted_images}
    videos_map = {x['id']: x for x in videos}

    return CocoMetadata(
        categories=categories_map,
        keypoint_categories=keypoint_categories_map,
        images=images_map,
        videos=videos_map,
    )


def convert(coco: Dict[str, List[dict]]) -> Tuple[types.DIVEAnnotationSchema, dict]:
    """
    Convert KWCOCO json to DIVE json tracks.
    """
    tracks: Dict[int, Track] = {}
    metadata_attributes: Dict[str, Dict[str, Any]] = {}
    test_vals: Dict[str, Dict[str, int]] = {}
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
            tracks[trackId] = Track(begin=frame, end=frame, id=trackId)

        track = tracks[trackId]
        track.begin = min(frame, track.begin)
        track.end = max(track.end, frame)
        track.features.append(feature)
        track.confidencePairs = confidence_pairs

        for (key, val) in track_attributes.items():
            track.attributes[key] = val
            viame.create_attributes(metadata_attributes, test_vals, 'track', key, val)
        for (key, val) in attributes.items():
            viame.create_attributes(metadata_attributes, test_vals, 'detection', key, val)

    # Now we process all the metadata_attributes for the types
    viame.calculate_attribute_types(metadata_attributes, test_vals)

    converted: types.DIVEAnnotationSchema = {
        'tracks': {
            str(trackId): track.dict(exclude_none=True) for trackId, track in tracks.items()
        },
        'groups': {},
        'version': constants.AnnotationsCurrentVersion,
    }
    return converted, models.MetadataMutable(attributes=metadata_attributes).dict(exclude_none=True)
