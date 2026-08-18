"""
COCO / KWCOCO JSON serializer and deserializer.

This module intentionally accepts the COCO base schema while also handling
KWCOCO-compatible extensions when they are present.
"""

import functools
import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

from dive_utils import constants, strNumericCompare, types
from dive_utils.models import CocoMetadata, Feature, Track

from . import viame

RLE_SEGMENTATION_WARNING = (
    'The COCO file included run-length encoded segmentation masks that are not supported. '
    'Bounding boxes and other annotation data were imported, but masks were skipped.'
)

PROB_TOP_K = 10
PROB_EPSILON = 0.001

PROB_LENGTH_MISMATCH_WARNING = (
    'Some annotations had a "prob" array whose length did not match the number of categories. '
    'Class probabilities were ignored for those annotations; the primary category and score '
    'were imported instead.'
)
PROB_DUPLICATE_CATEGORY_WARNING = (
    'The COCO file contains duplicate category names, so "prob" arrays cannot be mapped to '
    'class names. Class probabilities were ignored; primary categories and scores were '
    'imported instead.'
)
DIVE_CONFIDENCE_PAIRS_WARNING = (
    'Some annotations had malformed "dive_confidence_pairs" values. Those values were '
    'ignored; a valid "prob" vector or the primary category and score were imported instead.'
)
SUPERCATEGORY_MULTI_PARENT_WARNING = (
    'Some COCO categories declare multiple parents via "parents", which DIVE cannot '
    'represent. Only single-parent "supercategory" or one-element "parents" edges were imported.'
)
SUPERCATEGORY_DUPLICATE_CATEGORY_WARNING = (
    'The COCO file contains duplicate category names, so category hierarchy edges cannot be '
    'mapped to class names. The dataset type hierarchy was left unchanged.'
)
CATEGORY_MISSING_NAME_WARNING = (
    'Some COCO categories have no non-empty string name. Those positional category slots were '
    'ignored when importing classifications and hierarchy edges.'
)
SUPERCATEGORY_INVALID_WARNING = (
    'The category hierarchy in the COCO file could not be applied: {reason}. '
    'Annotations were imported without changing the dataset type hierarchy.'
)


def _has_duplicate_names(names: List[Optional[str]]) -> bool:
    usable_names = [name for name in names if isinstance(name, str) and name]
    return len(set(usable_names)) != len(usable_names)


def _parent_from_category(category: Dict[str, Any]) -> Optional[str]:
    """Prefer COCO supercategory; fall back to a single KWCOCO parents entry."""
    parent = category.get('supercategory')
    if isinstance(parent, str) and parent:
        return parent
    parents = category.get('parents')
    if isinstance(parents, list) and len(parents) == 1:
        candidate = parents[0]
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


def _confidence_pairs_from_prob(
    prob: List[Any], ordered_names: List[Optional[str]]
) -> Optional[List[Tuple[str, float]]]:
    """Map a positional KWCOCO probability vector to DIVE confidence pairs."""
    if len(prob) != len(ordered_names):
        return None
    pairs = [
        (name, min(1.0, max(0.0, float(value))))
        for name, value in zip(ordered_names, prob)
        if isinstance(name, str)
        and name
        and isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    ]
    pairs = [pair for pair in pairs if pair[1] > PROB_EPSILON]
    pairs.sort(key=lambda pair: pair[1], reverse=True)
    return pairs[:PROB_TOP_K] or None


def _confidence_pairs_from_extension(value: Any) -> Optional[List[Tuple[str, float]]]:
    """Read DIVE's sparse confidence extension without pruning zero-valued pairs."""
    if not isinstance(value, list) or not value:
        return None
    pairs: List[Tuple[str, float]] = []
    names = set()
    for pair in value:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            return None
        name, confidence = pair
        if (
            not isinstance(name, str)
            or not name
            or name in names
            or not isinstance(confidence, (int, float))
            or isinstance(confidence, bool)
            or not math.isfinite(confidence)
            or confidence < 0
            or confidence > 1
        ):
            return None
        names.add(name)
        pairs.append((name, float(confidence)))
    return pairs


def type_hierarchy_from_categories(
    coco: Dict[str, Any],
) -> Tuple[Optional[Dict[str, str]], List[str]]:
    """Derive DIVE child-to-parent edges from KWCOCO category supercategories."""
    categories = coco.get('categories', [])
    warnings: List[str] = []
    if any(
        isinstance(category.get('parents'), list) and len(category['parents']) > 1
        for category in categories
    ):
        warnings.append(SUPERCATEGORY_MULTI_PARENT_WARNING)

    names = [category.get('name') for category in categories]
    if any(not isinstance(name, str) or not name for name in names):
        warnings.append(CATEGORY_MISSING_NAME_WARNING)
    if _has_duplicate_names(names):
        warnings.append(SUPERCATEGORY_DUPLICATE_CATEGORY_WARNING)
        return None, warnings

    hierarchy: Dict[str, str] = {}
    for category in categories:
        name = category.get('name')
        parent = _parent_from_category(category)
        # Some producers spell roots as a self-supercategory; it is not an edge.
        if isinstance(name, str) and name and parent and name != parent:
            hierarchy[name] = parent
    return hierarchy or None, warnings


def _has_valid_bbox(annotation: dict) -> bool:
    bbox = annotation.get('bbox')
    return isinstance(bbox, list) and len(bbox) == 4


def _is_rle_segmentation(annotation: dict, segmentation=None) -> bool:
    """Return True if annotation uses COCO RLE / crowd segmentation.

    In COCO, ``iscrowd: 1`` marks a crowd region whose ``segmentation`` is RLE
    (a dict with ``counts`` and ``size``), not a polygon list. ``iscrowd: 0`` is a
    single instance with polygon segmentation. DIVE does not decode RLE masks;
    bbox and other fields may still import, but mask geometry is skipped.
    """
    if segmentation is None:
        segmentation = annotation.get('segmentation', [])
    return bool(annotation.get('iscrowd', False)) or isinstance(segmentation, dict)


def _extract_polygon_coords_lists(segmentation) -> List[List[Tuple[float, float]]]:
    """Parse COCO / KWCOCO polygon segmentations into coordinate lists."""
    if not segmentation or isinstance(segmentation, dict):
        return []

    if len(segmentation) > 1 and isinstance(segmentation[0], (int, float)):
        polygons = [segmentation]
    elif len(segmentation) == 1:
        polygons = [segmentation[0]]
    else:
        polygons = segmentation

    coord_lists: List[List[Tuple[float, float]]] = []
    for polygon in polygons:
        if isinstance(polygon, dict):
            coords = polygon.get('exterior', [])
        elif isinstance(polygon, list):
            coords = list(zip(polygon[::2], polygon[1::2]))
        else:
            continue
        if coords:
            coord_lists.append(coords)
    return coord_lists


def _bbox_from_points(points: List[Tuple[float, float]]) -> List[float]:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    x_min = min(xs)
    y_min = min(ys)
    return [x_min, y_min, max(xs) - x_min, max(ys) - y_min]


def _annotation_has_importable_bounds(annotation: dict) -> bool:
    if _has_valid_bbox(annotation):
        return True
    if _is_rle_segmentation(annotation):
        return False
    return bool(_extract_polygon_coords_lists(annotation.get('segmentation', [])))


def _missing_bounds_error(annotation_ids: List) -> str:
    shown = ', '.join(str(annotation_id) for annotation_id in annotation_ids[:10])
    extra = f' (and {len(annotation_ids) - 10} more)' if len(annotation_ids) > 10 else ''
    return (
        f'{len(annotation_ids)} COCO annotation(s) cannot be imported because '
        f'they have no bbox and '
        f'no usable polygon segmentation (ids: {shown}{extra}). '
        'Provide bbox [x, y, width, height] or polygon segmentation as [[x1, y1, ...]]. '
        'Annotations with only RLE segmentation masks still require a bbox.'
    )


def _resolve_coco_bbox(annotation: dict) -> List[float]:
    if _has_valid_bbox(annotation):
        return list(annotation['bbox'])

    coord_lists = _extract_polygon_coords_lists(annotation.get('segmentation', []))
    all_points = [point for coords in coord_lists for point in coords]
    if all_points:
        return _bbox_from_points(all_points)

    raise ValueError(_missing_bounds_error([annotation.get('id', '?')]))


def _validate_annotation_bounds(annotations: List[dict]) -> None:
    missing_ids = [
        annotation.get('id', '?')
        for annotation in annotations
        if not _annotation_has_importable_bounds(annotation)
    ]
    if missing_ids:
        raise ValueError(_missing_bounds_error(missing_ids))


def is_coco_json(coco: Dict[str, Any]):
    # Minimal COCO fields according to https://cocodataset.org/#format-data.
    # `info` and `licenses` are optional in common exports.
    keys = ['images', 'annotations', 'categories']
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

    bounds = _resolve_coco_bbox(annotation)
    # update from [TL_x, TL_y, width, height] to [TL_x, TL_y, BR_x, BR_y]
    bounds[2] += bounds[0]
    bounds[3] += bounds[1]

    return trackId, filename, frame, bounds


def _parse_annotation(
    annotation: dict, meta: CocoMetadata
) -> Tuple[dict, dict, dict, list, List[str], bool]:
    """
    Parse a single KWCOCO annotation into its composite track and detection parts
    """
    features: Dict[str, Any] = {}
    attributes: Dict[str, Any] = {}
    track_attributes: Dict[str, Any] = {}
    notes: List[str] = []

    category_id = annotation['category_id']
    score = annotation.get('score', 1.0)  # may not exist, default to 1.0
    category = meta.categories.get(category_id, {})
    class_name = category.get('name') or 'unknown'
    confidence_pair = (class_name, score)

    # parse keypoints
    keypoints = annotation.get('keypoints', [])
    head_tail = []
    for keypoint in keypoints:
        if isinstance(keypoint, (int, float)):  # [x1, y1, v1, ...] coco format
            keypoint_labels = category.get('keypoints', [])
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
    rle_skipped = _is_rle_segmentation(annotation, segmentation)

    if segmentation and not rle_skipped:
        coord_lists = _extract_polygon_coords_lists(segmentation)
        if coord_lists:
            viame.create_geoJSONFeature(features, 'Polygon', coord_lists[0])

    # DIVE extension fields for non-standard COCO attributes.
    detection_attributes = annotation.get(
        'dive_detection_attributes', annotation.get('attributes', {})
    )
    if isinstance(detection_attributes, dict):
        attributes.update(detection_attributes)
    track_attributes_value = annotation.get(
        'dive_track_attributes',
        annotation.get('track_attributes', {}),
    )
    if isinstance(track_attributes_value, dict):
        track_attributes.update(track_attributes_value)

    note_values = annotation.get('dive_notes', annotation.get('notes', []))
    if isinstance(note_values, list):
        notes.extend([str(value).strip() for value in note_values if str(value).strip()])
    elif isinstance(note_values, str) and note_values.strip():
        notes.append(note_values.strip())

    return features, attributes, track_attributes, [confidence_pair], notes, rle_skipped


def _parse_annotation_for_tracks(
    annotation: dict, meta: CocoMetadata
) -> Tuple[Feature, dict, dict, list, bool]:
    (
        features,
        attributes,
        track_attributes,
        confidence_pairs,
        notes,
        rle_skipped,
    ) = _parse_annotation(annotation, meta)
    trackId, filename, frame, bounds = annotation_info(annotation, meta)

    feature = Feature(
        frame=frame,
        bounds=bounds,
        attributes=attributes or None,
        notes=notes or None,
        fishLength=None,
        **features,
    )

    # Pass the rest of the unchanged info through as well
    return feature, attributes, track_attributes, confidence_pairs, rle_skipped


def load_coco_metadata(coco: Dict[str, Any]) -> CocoMetadata:
    categories = coco.get('categories', [])
    keypoint_categories = coco.get('keypoint_categories', [])
    images = coco.get('images', [])
    videos = coco.get('videos', [])
    annotations = coco.get('annotations', [])
    datasetInfo = (coco.get('info') or {}).get('dive_dataset_info') or {}

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
        datasetInfo=datasetInfo,
        ordered_category_names=[category.get('name') for category in categories],
    )


def load_coco_as_tracks_and_attributes(
    coco: Dict[str, Any],
) -> Tuple[types.DIVEAnnotationSchema, types.Attributes, types.Warnings, types.DatasetInfo]:
    """Convert KWCOCO json to DIVE json tracks.

    Returns (annotations, attributes, warnings, dataset_info); dataset_info is empty when the
    file carries no ``info.dive_dataset_info`` block.
    """
    tracks: Dict[int, Track] = {}
    metadata_attributes: types.Attributes = {}
    test_vals: Dict[str, Dict[str, int]] = {}
    warnings: types.Warnings = []
    skipped_rle_masks = False
    meta = load_coco_metadata(coco)
    annotations = coco.get('annotations', [])
    _validate_annotation_bounds(annotations)

    ordered_names = meta.ordered_category_names
    duplicate_category_names = _has_duplicate_names(ordered_names)
    prob_length_mismatch = False
    prob_ignored_for_duplicates = False

    # Process each logical track in frame order so confidence pairs describe its
    # temporal endpoint regardless of annotation order in the source file.  COCO
    # annotation IDs make equal-frame selection deterministic as well.
    annotations = sorted(
        annotations,
        key=lambda annotation: (
            meta.images[annotation['image_id']]['frame_index'],
            annotation['id'],
        ),
    )

    malformed_extension = False
    for annotation in annotations:
        (
            feature,
            attributes,
            track_attributes,
            confidence_pairs,
            rle_skipped,
        ) = _parse_annotation_for_tracks(annotation, meta)
        skipped_rle_masks = skipped_rle_masks or rle_skipped

        extension_present = 'dive_confidence_pairs' in annotation
        extension_pairs = _confidence_pairs_from_extension(annotation.get('dive_confidence_pairs'))
        if extension_pairs is not None:
            confidence_pairs = extension_pairs
        else:
            malformed_extension = malformed_extension or extension_present
            prob = annotation.get('prob')
            if isinstance(prob, list):
                if duplicate_category_names:
                    prob_ignored_for_duplicates = True
                else:
                    prob_pairs = _confidence_pairs_from_prob(prob, ordered_names)
                    if prob_pairs is None and len(prob) != len(ordered_names):
                        prob_length_mismatch = True
                    elif prob_pairs:
                        confidence_pairs = prob_pairs

        trackId, _, frame, _ = annotation_info(annotation, meta)

        if trackId not in tracks:
            tracks[trackId] = Track(begin=frame, end=frame, id=trackId)

        track = tracks[trackId]
        track.begin = min(frame, track.begin)
        track.end = max(track.end, frame)
        track.features.append(feature)
        track.confidencePairs = confidence_pairs

        for key, val in track_attributes.items():
            track.attributes[key] = val
            viame.create_attributes(metadata_attributes, test_vals, 'track', key, val)
        for key, val in attributes.items():
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
    if skipped_rle_masks:
        warnings.append(RLE_SEGMENTATION_WARNING)
    if prob_length_mismatch:
        warnings.append(PROB_LENGTH_MISMATCH_WARNING)
    if prob_ignored_for_duplicates:
        warnings.append(PROB_DUPLICATE_CATEGORY_WARNING)
    if malformed_extension:
        warnings.append(DIVE_CONFIDENCE_PAIRS_WARNING)
    return converted, metadata_attributes, warnings, meta.datasetInfo


def _feature_to_segmentation(feature: Feature) -> List[List[float]]:
    """Convert DIVE polygon geometry to COCO segmentation format."""
    segmentation: List[List[float]] = []
    if not feature.geometry:
        return segmentation
    for geo_feature in feature.geometry.features:
        if geo_feature.geometry.type != 'Polygon':
            continue
        coordinates = geo_feature.geometry.coordinates
        if not coordinates or not coordinates[0]:
            continue
        flat_coords: List[float] = []
        for x, y in coordinates[0]:
            flat_coords.extend([x, y])
        if flat_coords:
            segmentation.append(flat_coords)
    return segmentation


def _feature_to_keypoints(feature: Feature) -> Tuple[List[float], int]:
    """Extract head/tail keypoints from DIVE geometry in COCO format."""
    if not feature.geometry:
        return [], 0
    points: Dict[str, List[float]] = {}
    for geo_feature in feature.geometry.features:
        if geo_feature.geometry.type != 'Point':
            continue
        key = geo_feature.properties.get('key')
        if key not in ('head', 'tail'):
            continue
        coords = geo_feature.geometry.coordinates
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        points[key] = [coords[0], coords[1], 2]
    if not points:
        return [], 0
    keypoints: List[float] = []
    count = 0
    for label in ('head', 'tail'):
        value = points.get(label, [0, 0, 0])
        keypoints.extend(value)
        if value[2] > 0:
            count += 1
    return keypoints, count


def export_dive_as_coco(
    tracks: Iterable[dict],
    image_filenames: Dict[int, str],
    dataset_name: str,
    datasetInfo: Optional[types.DatasetInfo] = None,
    typeHierarchy: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Export DIVE tracks to a single-dataset COCO JSON document.

    Args:
        tracks: Track documents matching ``dive_utils.models.Track`` schema.
        image_filenames: Frame-indexed filename mapping for the dataset.
        dataset_name: Human-readable dataset name used in the COCO info block.
        datasetInfo: per-dataset station metadata; when present, written under
            ``info.dive_dataset_info`` and advertised in ``info.dive_extensions``.
            Omitted entirely when empty.
        typeHierarchy: DIVE child-to-parent category hierarchy, emitted through
            KWCOCO's ``categories[].supercategory`` field.
    """
    parsed_tracks = [Track(**track_doc) for track_doc in tracks]
    category_names: List[str] = []

    def add_category_name(name: str) -> None:
        if name not in category_names:
            category_names.append(name)

    for track in parsed_tracks:
        for name, _confidence in track.confidencePairs:
            add_category_name(name)
    for name in sorted((typeHierarchy or {}).keys()):
        add_category_name(name)
    for name in sorted(set((typeHierarchy or {}).values())):
        add_category_name(name)

    categories = {name: index + 1 for index, name in enumerate(category_names)}
    coco_annotations: List[dict] = []
    images: Dict[int, dict] = {}
    annotation_id = 1

    for track in parsed_tracks:
        for feature in track.features:
            if feature.frame not in image_filenames:
                continue
            if not feature.bounds:
                continue
            if not track.confidencePairs:
                continue
            class_name, score = max(track.confidencePairs, key=lambda x: x[1])
            category_id = categories[class_name]
            x1, y1, x2, y2 = feature.bounds
            width = max(0, x2 - x1)
            height = max(0, y2 - y1)
            image_id = feature.frame + 1
            images.setdefault(
                image_id,
                {
                    'id': image_id,
                    'file_name': image_filenames[feature.frame],
                    'frame_index': feature.frame,
                },
            )
            segmentation = _feature_to_segmentation(feature)
            keypoints, num_keypoints = _feature_to_keypoints(feature)
            annotation = {
                'id': annotation_id,
                'image_id': image_id,
                'category_id': category_id,
                'bbox': [x1, y1, width, height],
                'area': width * height,
                # Single-instance polygon export; DIVE does not emit crowd RLE (iscrowd: 1).
                'iscrowd': 0,
                'score': score,
                # KWCOCO probability vectors align with document category order.
                'prob': [dict(track.confidencePairs).get(name, 0.0) for name in category_names],
                # Preserve sparse membership and explicit zero confidence without
                # requiring consumers to infer it from a dense probability vector.
                'dive_confidence_pairs': [list(pair) for pair in track.confidencePairs],
            }
            # Keep a stable object identity across frames when track data exists.
            annotation['track_id'] = track.id
            if feature.attributes:
                annotation['dive_detection_attributes'] = feature.attributes
            if track.attributes:
                annotation['dive_track_attributes'] = track.attributes
            if feature.notes:
                annotation['dive_notes'] = feature.notes
            if segmentation:
                annotation['segmentation'] = segmentation
            if keypoints:
                annotation['keypoints'] = keypoints
                annotation['num_keypoints'] = num_keypoints
            coco_annotations.append(annotation)
            annotation_id += 1

    categories_doc: List[dict] = []
    for class_name, category_id in categories.items():
        category: Dict[str, Any] = {'id': category_id, 'name': class_name}
        parent = (typeHierarchy or {}).get(class_name)
        if parent is not None:
            category['supercategory'] = parent
        # When keypoints are exported, publish the category labels explicitly.
        category['keypoints'] = ['head', 'tail']
        categories_doc.append(category)

    info: Dict[str, Any] = {
        'description': f'DIVE export for {dataset_name}',
        'dive_extensions': [
            'dive_detection_attributes',
            'dive_track_attributes',
            'dive_notes',
            'dive_confidence_pairs',
        ],
    }
    if datasetInfo:
        info['dive_dataset_info'] = datasetInfo
        info['dive_extensions'].append('dive_dataset_info')

    return {
        'info': info,
        'images': list(images.values()),
        'annotations': coco_annotations,
        'categories': categories_doc,
    }
