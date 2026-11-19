"""Admin annotation inventory stats (datasets / tracks / labels / curation classes)."""

from collections import Counter
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple, TypedDict

import pymongo

from dive_utils import TRUTHY_META_VALUES, constants, types

ProgressCallback = Callable[[str], None]

ANNOTATION_STATS_LATEST = constants.AnnotationStatsLatestFileName

# Classification thresholds (aligned with admin Mongo sketches)
# Mostly manual: at least 25% manual in a dataset with more than 10 tracks,
# or a small dataset (<= 10 tracks) whose tracks are all manual. The small
# all-manual arm uses <= 10 so a 10-track all-manual dataset is not left in
# neither arm by the strict > 10 / < 10 split.
MANUAL_FRAC = 0.25
MOSTLY_MANUAL_TRACK_THRESHOLD = 10
# Backwards-compatible alias: the old 5-track minimum no longer applies.
MIN_MANUAL_TRACKS = MOSTLY_MANUAL_TRACK_THRESHOLD
MIN_COMPUTED_FOR_MIXED = 10
MIN_CORRECTED_FOR_MIXED = 15
CORRECTED_FRAC_OF_COMPUTED = 0.25

# Cheap per-dataset count pass: chunk folder IDs for indexed `$in` matches.
COUNT_ID_CHUNK_SIZE = 250
# Pack heavy aggregations so each batch covers roughly this many live tracks.
# Skewed folders (millions of tracks) still become solo batches.
TRACK_BATCH_BUDGET = 500_000
# Also cap `$in` width when many tiny datasets would pack under the track budget.
MAX_DATASETS_PER_BATCH = 500
# Per-batch client-side operation timeout (seconds); replaces default socketTimeoutMS.
AGGREGATE_BATCH_TIMEOUT_S = 600


class DatasetKindCounts(TypedDict):
    total: int
    mostlyManual: int
    mixedSubstantialCorrections: int
    mostlyComputed: int
    empty: int


class TrackCounts(TypedDict):
    total: int
    confidenceGte1: int
    # Sum of ``len(features)`` over live tracks; each stored Feature is one detection.
    detections: int


class MediaCounts(TypedDict):
    # Logical videos: one per video dataset / multicam camera folder (see
    # fold_media_counts) — never one per file, so an original + its transcoded
    # derivative count once.
    videos: int
    # Datasets / multicam camera folders whose type is image-sequence.
    imageSequences: int
    # Individual image files across image-sequence and large-image datasets.
    images: int


CURATION_CLASSES = (
    'mostlyManual',
    'mixedSubstantialCorrections',
    'mostlyComputed',
    'empty',
)


class CurationClassBreakdown(TypedDict):
    """Annotation + media totals for one curation class (see classification)."""

    datasets: int
    tracks: int
    detections: int
    confidenceGte1: int
    manualTracks: int
    # Non-manual tracks whose first confidence pair is >= 1.
    correctedTracks: int
    # Detection-level geometry counts. A detection can carry several geometry
    # types (e.g. a polygon plus head/tail points), so Polygon / Point /
    # LineString counts overlap; boundingBoxOnly is exclusive (no geometry).
    geometryTypes: Dict[str, int]
    detectionsWithPolygon: int
    detectionsWithPoint: int
    detectionsWithLineString: int
    detectionsWithGeometry: int
    detectionsBoundsOnly: int
    # Detections whose bounds start at (0, 0) with positive extent — a proxy
    # for full-frame annotations; exact media size is not stored on tracks.
    fullFrameDetections: int
    # Track-level counterparts: tracks with at least one such detection
    # (tracksBoundsOnly: tracks whose detections are all bounds-only).
    tracksWithPolygon: int
    tracksWithPoint: int
    tracksWithLineString: int
    tracksWithGeometry: int
    tracksBoundsOnly: int
    tracksFullFrame: int
    media: MediaCounts


class LabelCount(TypedDict):
    label: str
    count: int


class ActiveUsersCounts(TypedDict):
    # Distinct users whose most recent qualifying activity falls in each
    # window, ending at the report's generation time. Windows are nested, so
    # counts are monotonically non-decreasing down this list.
    lastMonth: int
    last3Months: int
    last6Months: int
    lastYear: int
    last5Years: int


# (report key, window length), shortest first. Day counts mirror the
# approximations the admin stats endpoint already uses (90d ≈ 3 months, …).
ACTIVE_USER_WINDOWS: Tuple[Tuple[str, timedelta], ...] = (
    ('lastMonth', timedelta(days=30)),
    ('last3Months', timedelta(days=90)),
    ('last6Months', timedelta(days=180)),
    ('lastYear', timedelta(days=365)),
    ('last5Years', timedelta(days=5 * 365)),
)


class AnnotationStatsReport(TypedDict):
    generatedAt: str
    datasets: DatasetKindCounts
    tracks: TrackCounts
    media: MediaCounts
    labels: List[LabelCount]
    activeUsers: ActiveUsersCounts
    # Per-curation-class annotation / geometry / media breakdown, keyed by
    # the same names as DatasetKindCounts (plus ``empty``). Optional only for
    # reports saved before this field existed, handled on the client.
    curationBreakdown: Dict[str, CurationClassBreakdown]


class DatasetTrackRow(TypedDict):
    """Per-dataset live-track counters from the trackItem aggregation."""

    dataset: Any
    total: int
    manual: int
    # Non-manual tracks whose first confidence pair is >= 1 (accept / type-set proxy)
    conf1NonManual: int
    confidenceGte1: int
    detections: int
    # Per-detection geometry tallies (see CurationClassBreakdown). Rows from
    # older aggregations / injected test rows may omit these; folds default 0.
    detectionsWithPolygon: int
    detectionsWithPoint: int
    detectionsWithLineString: int
    detectionsWithGeometry: int
    detectionsBoundsOnly: int
    fullFrameDetections: int
    tracksWithPolygon: int
    tracksWithPoint: int
    tracksWithLineString: int
    tracksWithGeometry: int
    tracksBoundsOnly: int
    tracksFullFrame: int


def classify_dataset_row(row: DatasetTrackRow) -> str:
    """
    Classify a dataset with live tracks.

    Returns one of: mostlyManual, mixedSubstantialCorrections, mostlyComputed.
    Corrections are inferred from non-manual tracks with first-pair confidence >= 1
    (no features.userModified scan).
    """
    total = int(row.get('total') or 0)
    manual = int(row.get('manual') or 0)
    computed = max(total - manual, 0)
    corrected = int(row.get('conf1NonManual') or 0)
    manual_frac = (manual / total) if total else 0.0
    corrected_frac = (corrected / computed) if computed else 0.0

    if (total > MOSTLY_MANUAL_TRACK_THRESHOLD and manual_frac >= MANUAL_FRAC) or (
        0 < total <= MOSTLY_MANUAL_TRACK_THRESHOLD and manual == total
    ):
        return 'mostlyManual'
    if (
        computed >= MIN_COMPUTED_FOR_MIXED
        and corrected >= MIN_CORRECTED_FOR_MIXED
        and corrected_frac >= CORRECTED_FRAC_OF_COMPUTED
    ):
        return 'mixedSubstantialCorrections'
    return 'mostlyComputed'


def fold_dataset_rows(
    rows: Iterable[DatasetTrackRow],
    dataset_folder_total: int,
) -> Dict[str, Any]:
    """Fold per-dataset aggregation rows into totals + classification counts."""
    datasets: DatasetKindCounts = {
        'total': int(dataset_folder_total),
        'mostlyManual': 0,
        'mixedSubstantialCorrections': 0,
        'mostlyComputed': 0,
        'empty': 0,
    }
    tracks: TrackCounts = {
        'total': 0,
        'confidenceGte1': 0,
        'detections': 0,
    }
    datasets_with_tracks = 0

    for row in rows:
        total = int(row.get('total') or 0)
        if total <= 0:
            continue
        datasets_with_tracks += 1
        tracks['total'] += total
        tracks['confidenceGte1'] += int(row.get('confidenceGte1') or 0)
        tracks['detections'] += int(row.get('detections') or 0)
        kind = classify_dataset_row(row)
        datasets[kind] = datasets[kind] + 1  # type: ignore[literal-required]

    empty = max(int(dataset_folder_total) - datasets_with_tracks, 0)
    datasets['empty'] = empty
    return {'datasets': datasets, 'tracks': tracks}


def _empty_curation_breakdown() -> CurationClassBreakdown:
    return {
        'datasets': 0,
        'tracks': 0,
        'detections': 0,
        'confidenceGte1': 0,
        'manualTracks': 0,
        'correctedTracks': 0,
        'geometryTypes': {'Polygon': 0, 'Point': 0, 'LineString': 0, 'boundingBoxOnly': 0},
        'detectionsWithPolygon': 0,
        'detectionsWithPoint': 0,
        'detectionsWithLineString': 0,
        'detectionsWithGeometry': 0,
        'detectionsBoundsOnly': 0,
        'fullFrameDetections': 0,
        'tracksWithPolygon': 0,
        'tracksWithPoint': 0,
        'tracksWithLineString': 0,
        'tracksWithGeometry': 0,
        'tracksBoundsOnly': 0,
        'tracksFullFrame': 0,
        'media': {'videos': 0, 'imageSequences': 0, 'images': 0},
    }


def fold_curation_breakdown(
    rows: Iterable[DatasetTrackRow],
    dataset_folder_total: int,
    folders: Optional[Iterable[Dict[str, Any]]] = None,
    image_counts_by_folder: Optional[Dict[Any, int]] = None,
) -> Dict[str, CurationClassBreakdown]:
    """
    Fold per-dataset rows into one breakdown per curation class.

    Annotation / geometry counts come from the track rows (classified with
    :func:`classify_dataset_row`). Media counts, when ``folders`` are given,
    are attributed to the class of the dataset that owns the media — a folder
    with no live-track row is ``empty`` — so the per-class media totals sum
    to the report-wide media totals. Without folders (injected test rows)
    every class's media stays zero.
    """
    breakdown: Dict[str, CurationClassBreakdown] = {
        kind: _empty_curation_breakdown() for kind in CURATION_CLASSES
    }
    kind_by_dataset: Dict[str, str] = {}
    datasets_with_tracks = 0
    for row in rows:
        total = int(row.get('total') or 0)
        if total <= 0:
            continue
        datasets_with_tracks += 1
        kind = classify_dataset_row(row)
        kind_by_dataset[str(row.get('dataset'))] = kind
        entry = breakdown[kind]
        entry['datasets'] += 1
        entry['tracks'] += total
        entry['detections'] += int(row.get('detections') or 0)
        entry['confidenceGte1'] += int(row.get('confidenceGte1') or 0)
        entry['manualTracks'] += int(row.get('manual') or 0)
        entry['correctedTracks'] += int(row.get('conf1NonManual') or 0)
        for field in (
            'detectionsWithPolygon',
            'detectionsWithPoint',
            'detectionsWithLineString',
            'detectionsWithGeometry',
            'detectionsBoundsOnly',
            'fullFrameDetections',
            'tracksWithPolygon',
            'tracksWithPoint',
            'tracksWithLineString',
            'tracksWithGeometry',
            'tracksBoundsOnly',
            'tracksFullFrame',
        ):
            entry[field] += int(row.get(field) or 0)  # type: ignore[call-overload]
        entry['geometryTypes'] = {
            'Polygon': entry['detectionsWithPolygon'],
            'Point': entry['detectionsWithPoint'],
            'LineString': entry['detectionsWithLineString'],
            'boundingBoxOnly': entry['detectionsBoundsOnly'],
        }
    breakdown['empty']['datasets'] = max(int(dataset_folder_total) - datasets_with_tracks, 0)
    if folders is not None:
        folder_list = list(folders)
        folders_by_id = {str(doc['_id']): doc for doc in folder_list}
        counts_by_root = {
            str(folder_id): int(count or 0)
            for folder_id, count in (image_counts_by_folder or {}).items()
        }
        for doc in folder_list:
            kind = kind_by_dataset.get(str(doc['_id']), 'empty')
            media = breakdown[kind]['media']
            delta = _folder_media_delta(doc, folders_by_id, counts_by_root)
            media['videos'] += delta['videos']
            media['imageSequences'] += delta['imageSequences']
            media['images'] += delta['images']
    return breakdown


def _empty_active_users() -> ActiveUsersCounts:
    return {
        'lastMonth': 0,
        'last3Months': 0,
        'last6Months': 0,
        'lastYear': 0,
        'last5Years': 0,
    }


def _as_utc(value: datetime) -> datetime:
    """Normalize a stored timestamp to aware UTC (Mongo datetimes are naive UTC)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def merge_latest_activity(
    *row_groups: Iterable[Dict[str, Any]],
) -> Dict[str, datetime]:
    """
    Merge ``{'user', 'latest'}`` aggregation rows into per-user latest activity.

    Keys are stringified so the same person merges even if one source stores
    their id as an ObjectId and another as a string.
    """
    merged: Dict[str, datetime] = {}
    for rows in row_groups:
        for row in rows:
            user = row.get('user')
            latest = row.get('latest')
            if user is None or not isinstance(latest, datetime):
                continue
            key = str(user)
            if key not in merged or _as_utc(latest) > _as_utc(merged[key]):
                merged[key] = latest
    return merged


def fold_active_users(
    latest_activity_by_user: Dict[str, datetime],
    now: datetime,
) -> ActiveUsersCounts:
    """
    Count distinct active users per window from each user's latest activity.

    A user is *active* if they uploaded a dataset (created an annotate folder)
    or modified/saved tracks (authored a revision-log entry). The windows are
    nested and every window ends at ``now``, so a user belongs to a window
    exactly when their *most recent* qualifying activity is inside it — older
    activity never needs to be examined.
    """
    counts = _empty_active_users()
    reference = _as_utc(now)
    for latest in latest_activity_by_user.values():
        latest_utc = _as_utc(latest)
        for key, window in ACTIVE_USER_WINDOWS:
            if latest_utc >= reference - window:
                counts[key] = counts[key] + 1  # type: ignore[literal-required]
    return counts


def _dataset_uploader_pipeline(since: datetime) -> List[Dict[str, Any]]:
    """Latest dataset-upload time per user (annotate folders they created)."""
    return [
        {
            '$match': {
                **_annotate_folder_query(),
                'created': {'$gte': since},
                'creatorId': {'$exists': True, '$ne': None},
            }
        },
        {'$group': {'_id': '$creatorId', 'latest': {'$max': '$created'}}},
        {'$project': {'_id': 0, 'user': '$_id', 'latest': 1}},
    ]


def _track_editor_pipeline(since: datetime) -> List[Dict[str, Any]]:
    """
    Latest track-save time per user, from revision-log authorship.

    ``save_annotations`` writes one revision-log entry (with ``author_id`` and
    ``created``) whenever tracks/groups are added or deleted, so the log is the
    only record tying a user and a time to a track modification. Entries are
    also written for annotation imports and clone initialization, which go
    through the same save path.
    """
    return [
        {
            '$match': {
                'created': {'$gte': since},
                'author_id': {'$exists': True, '$ne': None},
            }
        },
        {'$group': {'_id': '$author_id', 'latest': {'$max': '$created'}}},
        {'$project': {'_id': 0, 'user': '$_id', 'latest': 1}},
    ]


def _compute_active_users(
    *,
    now: datetime,
    progress: Optional[ProgressCallback],
) -> ActiveUsersCounts:
    """Live active-user counts: two grouped aggregations merged per user."""
    from girder.models.folder import Folder

    from dive_server.crud_annotation import RevisionLogItem

    since = _as_utc(now) - ACTIVE_USER_WINDOWS[-1][1]
    if progress is not None:
        progress('Counting active users (dataset uploads and track saves)...')
    upload_rows = list(
        Folder().collection.aggregate(_dataset_uploader_pipeline(since), allowDiskUse=True)
    )
    editor_rows = list(
        RevisionLogItem().collection.aggregate(_track_editor_pipeline(since), allowDiskUse=True)
    )
    counts = fold_active_users(merge_latest_activity(upload_rows, editor_rows), now)
    if progress is not None:
        detail = ', '.join(
            f'{key}={counts[key]}'  # type: ignore[literal-required]
            for key, _ in ACTIVE_USER_WINDOWS
        )
        progress(f'Active users ready: {detail}')
    return counts


def _top_pair_label_expr() -> Dict[str, Any]:
    """Mongo expression: raw type name of the highest-score confidence pair."""
    return {
        '$let': {
            'vars': {
                'top': {
                    '$reduce': {
                        'input': {'$ifNull': ['$confidencePairs', []]},
                        'initialValue': [],
                        'in': {
                            '$cond': [
                                {
                                    '$or': [
                                        {'$eq': [{'$size': '$$value'}, 0]},
                                        {
                                            '$gt': [
                                                {'$arrayElemAt': ['$$this', 1]},
                                                {'$arrayElemAt': ['$$value', 1]},
                                            ]
                                        },
                                    ]
                                },
                                '$$this',
                                '$$value',
                            ]
                        },
                    }
                }
            },
            'in': {'$arrayElemAt': ['$$top', 0]},
        }
    }


def _live_track_match(dataset_ids: Sequence[Any]) -> Dict[str, Any]:
    """Match live tracks for a batch of annotate-folder IDs (uses dataset index)."""
    return {
        'dataset': {'$in': list(dataset_ids)},
        'rev_deleted': {'$exists': False},
    }


def _geo_features_expr() -> Dict[str, Any]:
    """Mongo expr: GeoJSON sub-features of the ``$$this`` feature in a $reduce."""
    return {'$ifNull': ['$$this.geometry.features', []]}


def _detection_stats_expr() -> Dict[str, Any]:
    """
    Mongo ``$reduce`` over a track's features tallying geometry per detection.

    A Point counts from a GeoJSON Point geometry or a stored head/tail point.
    Full-frame is the origin-anchored bounds proxy described on
    :class:`CurationClassBreakdown`.
    """
    full_frame = {
        '$and': [
            {'$eq': [{'$arrayElemAt': ['$$this.bounds', 0]}, 0]},
            {'$eq': [{'$arrayElemAt': ['$$this.bounds', 1]}, 0]},
            {'$gt': [{'$arrayElemAt': ['$$this.bounds', 2]}, 0]},
            {'$gt': [{'$arrayElemAt': ['$$this.bounds', 3]}, 0]},
        ]
    }

    def _tally(field: str, condition: Any) -> Dict[str, Any]:
        return {'$add': [f'$$value.{field}', {'$cond': [condition, 1, 0]}]}

    # One $let per feature computes the geometry type list (and head/tail
    # flags) once; every tally then reads those vars. Without this, Mongo
    # re-walks ``geometry.features`` for each type check, the size check,
    # and again inside the boundsOnly negation.
    has_geometry = {
        '$or': [
            {'$gt': [{'$size': '$$geoTypes'}, 0]},
            '$$hasHead',
            '$$hasTail',
        ]
    }
    tallies = {
        '$let': {
            'vars': {
                'geoTypes': {
                    '$map': {
                        'input': _geo_features_expr(),
                        'as': 'gf',
                        'in': '$$gf.geometry.type',
                    }
                },
                'hasHead': {'$isArray': '$$this.head'},
                'hasTail': {'$isArray': '$$this.tail'},
            },
            'in': {
                'withPolygon': _tally('withPolygon', {'$in': ['Polygon', '$$geoTypes']}),
                'withPoint': _tally(
                    'withPoint',
                    {'$or': [{'$in': ['Point', '$$geoTypes']}, '$$hasHead', '$$hasTail']},
                ),
                'withLineString': _tally('withLineString', {'$in': ['LineString', '$$geoTypes']}),
                'withGeometry': _tally('withGeometry', has_geometry),
                'boundsOnly': _tally('boundsOnly', {'$not': [has_geometry]}),
                'fullFrame': _tally('fullFrame', full_frame),
            },
        }
    }

    return {
        '$reduce': {
            'input': {'$ifNull': ['$features', []]},
            'initialValue': {
                'withPolygon': 0,
                'withPoint': 0,
                'withLineString': 0,
                'withGeometry': 0,
                'boundsOnly': 0,
                'fullFrame': 0,
            },
            'in': tallies,
        }
    }


def _track_flag(field: str) -> Dict[str, Any]:
    """Group accumulator: tracks whose per-detection tally ``field`` is > 0."""
    return {'$sum': {'$cond': [{'$gt': [f'$detStats.{field}', 0]}, 1, 0]}}


def _dataset_track_pipeline(dataset_ids: Sequence[Any]) -> List[Dict[str, Any]]:
    """Aggregate live tracks per dataset with curation signals.

    Reads ``attributes`` / ``confidencePairs`` plus the size of ``features``
    (each stored Feature is one detection, so ``$size`` is the per-track
    detection count) and a ``$reduce`` over features for per-detection
    geometry tallies. Scoped to ``dataset_ids`` so Mongo can use the
    existing (dataset, …) index, and folded into this existing pass rather
    than a second trackItem scan.
    """
    return [
        {'$match': _live_track_match(dataset_ids)},
        {
            '$project': {
                '_id': 0,
                'dataset': 1,
                'userCreated': {'$eq': ['$attributes.userCreated', True]},
                'firstConf': {'$arrayElemAt': [{'$arrayElemAt': ['$confidencePairs', 0]}, 1]},
                'detections': {'$size': {'$ifNull': ['$features', []]}},
                'detStats': _detection_stats_expr(),
            }
        },
        {
            '$group': {
                '_id': '$dataset',
                'total': {'$sum': 1},
                'manual': {'$sum': {'$cond': ['$userCreated', 1, 0]}},
                'conf1NonManual': {
                    '$sum': {
                        '$cond': [
                            {
                                '$and': [
                                    {'$not': ['$userCreated']},
                                    {'$gte': ['$firstConf', 1]},
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
                'confidenceGte1': {'$sum': {'$cond': [{'$gte': ['$firstConf', 1]}, 1, 0]}},
                'detections': {'$sum': '$detections'},
                'detectionsWithPolygon': {'$sum': '$detStats.withPolygon'},
                'detectionsWithPoint': {'$sum': '$detStats.withPoint'},
                'detectionsWithLineString': {'$sum': '$detStats.withLineString'},
                'detectionsWithGeometry': {'$sum': '$detStats.withGeometry'},
                'detectionsBoundsOnly': {'$sum': '$detStats.boundsOnly'},
                'fullFrameDetections': {'$sum': '$detStats.fullFrame'},
                'tracksWithPolygon': _track_flag('withPolygon'),
                'tracksWithPoint': _track_flag('withPoint'),
                'tracksWithLineString': _track_flag('withLineString'),
                'tracksWithGeometry': _track_flag('withGeometry'),
                'tracksFullFrame': _track_flag('fullFrame'),
                'tracksBoundsOnly': {
                    '$sum': {
                        '$cond': [
                            {
                                '$and': [
                                    {'$gt': ['$detections', 0]},
                                    {'$eq': ['$detStats.withGeometry', 0]},
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
            }
        },
        {
            '$project': {
                '_id': 0,
                'dataset': '$_id',
                'total': 1,
                'manual': 1,
                'conf1NonManual': 1,
                'confidenceGte1': 1,
                'detections': 1,
                'detectionsWithPolygon': 1,
                'detectionsWithPoint': 1,
                'detectionsWithLineString': 1,
                'detectionsWithGeometry': 1,
                'detectionsBoundsOnly': 1,
                'fullFrameDetections': 1,
                'tracksWithPolygon': 1,
                'tracksWithPoint': 1,
                'tracksWithLineString': 1,
                'tracksWithGeometry': 1,
                'tracksBoundsOnly': 1,
                'tracksFullFrame': 1,
            }
        },
    ]


def _label_pipeline(dataset_ids: Sequence[Any]) -> List[Dict[str, Any]]:
    """Count live tracks by highest raw confidence-pair type name for a batch."""
    return [
        {'$match': _live_track_match(dataset_ids)},
        {'$project': {'_id': 0, 'label': _top_pair_label_expr()}},
        {'$match': {'$expr': {'$eq': [{'$type': '$label'}, 'string']}}},
        {'$group': {'_id': '$label', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1, '_id': 1}},
        {'$project': {'_id': 0, 'label': '$_id', 'count': 1}},
    ]


def _annotate_folder_query() -> Dict[str, Any]:
    return {f'meta.{constants.DatasetMarker}': {'$in': TRUTHY_META_VALUES}}


def _annotate_folders() -> List[Dict[str, Any]]:
    """Return annotate dataset folders with only the fields media counting needs.

    Projecting ``meta.type`` (plus the clone pointer) keeps this to one cheap
    Folder query that also supplies the folder IDs / total, instead of a
    per-dataset ``get_media``-style lookup per folder.
    """
    from girder.models.folder import Folder

    return list(
        Folder().find(
            _annotate_folder_query(),
            fields={'_id': 1, 'meta.type': 1, constants.ForeignMediaIdMarker: 1},
        )
    )


def _annotate_folder_ids() -> List[Any]:
    """Return ``_id``s of all annotate dataset folders."""
    return [doc['_id'] for doc in _annotate_folders()]


# Folder types whose items are individual frames (images themselves).
# Large-image datasets are not image *sequences*, but their files are images.
IMAGE_BEARING_TYPES = (constants.ImageSequenceType, constants.LargeImageType)


def _effective_media_root_id(folder_id: str, folders_by_id: Dict[str, Dict[str, Any]]) -> str:
    """Follow ``foreign_media_id`` clone pointers to the folder holding the items.

    Clones share their source's media items; resolving the root once per
    folder (in-memory, over the already-fetched folder docs) lets image
    counts be aggregated once per root and then attributed to each dataset.
    """
    seen = set()
    current = folder_id
    while current not in seen:
        seen.add(current)
        doc = folders_by_id.get(current)
        if doc is None:
            break
        root = doc.get(constants.ForeignMediaIdMarker)
        if not root:
            break
        current = str(root)
    return current


def fold_media_counts(
    folders: Iterable[Dict[str, Any]],
    image_counts_by_folder: Optional[Dict[Any, int]] = None,
) -> MediaCounts:
    """
    Fold annotate folder docs (+ per-folder image counts) into media totals.

    Videos and image sequences are counted per *logical* dataset, from
    ``meta.type`` — one per video / image-sequence folder, including each
    multicam camera folder (the ``multi`` parent itself counts as neither).
    Counting folders rather than files is what keeps transcoding honest with
    no per-folder item queries: a video folder may hold both the original
    (``meta.source_video=True``) and its ``*.transcoded.mp4`` derivative
    (``source_video=False, codec=h264``), or a single web-safe original when
    transcoding was skipped — either way it is exactly one video.

    ``image_counts_by_folder`` maps a *media root* folder id (clones resolved
    via :func:`_effective_media_root_id`) to its image-item count; each
    image-sequence / large-image dataset contributes its root's count, so a
    clone's images count toward that clone just as its copied tracks do.
    """
    folder_list = list(folders)
    folders_by_id = {str(doc['_id']): doc for doc in folder_list}
    counts_by_root = {
        str(folder_id): int(count or 0)
        for folder_id, count in (image_counts_by_folder or {}).items()
    }
    media: MediaCounts = {'videos': 0, 'imageSequences': 0, 'images': 0}
    for doc in folder_list:
        delta = _folder_media_delta(doc, folders_by_id, counts_by_root)
        media['videos'] += delta['videos']
        media['imageSequences'] += delta['imageSequences']
        media['images'] += delta['images']
    return media


def _folder_media_delta(
    doc: Dict[str, Any],
    folders_by_id: Dict[str, Dict[str, Any]],
    counts_by_root: Dict[str, int],
) -> MediaCounts:
    """One folder's contribution to the logical media totals."""
    media: MediaCounts = {'videos': 0, 'imageSequences': 0, 'images': 0}
    media_type = (doc.get('meta') or {}).get(constants.TypeMarker)
    if media_type == constants.VideoType:
        media['videos'] = 1
    elif media_type == constants.ImageSequenceType:
        media['imageSequences'] = 1
    if media_type in IMAGE_BEARING_TYPES:
        root_id = _effective_media_root_id(str(doc['_id']), folders_by_id)
        media['images'] = counts_by_root.get(root_id, 0)
    return media


def _image_count_pipeline(folder_ids: Sequence[Any]) -> List[Dict[str, Any]]:
    """Count image items per folder in one grouped pass over the Item collection.

    Matches the extensions :func:`dive_server.crud.valid_large_images` accepts
    (all valid image + large-image formats), so an as-yet-unconverted original
    counts once and its converted replacement — which deletes the original —
    also counts once.
    """
    return [
        {
            '$match': {
                'folderId': {'$in': list(folder_ids)},
                'lowerName': {'$regex': constants.allLargeImageRegEx.pattern},
            }
        },
        {'$group': {'_id': '$folderId', 'n': {'$sum': 1}}},
        {'$project': {'_id': 0, 'folderId': '$_id', 'n': 1}},
    ]


def _compute_media_counts(
    folders: List[Dict[str, Any]],
    *,
    progress: Optional[ProgressCallback],
) -> MediaCounts:
    """Live media totals: folder-type counts + one chunked Item aggregation for images."""
    media, _ = _compute_media_counts_and_images(folders, progress=progress)
    return media


def _compute_media_counts_and_images(
    folders: List[Dict[str, Any]],
    *,
    progress: Optional[ProgressCallback],
) -> Tuple[MediaCounts, Dict[Any, int]]:
    """Live media totals plus the per-root image counts they were folded from."""
    folders_by_id = {str(doc['_id']): doc for doc in folders}
    root_ids: List[Any] = []
    seen_roots = set()
    for doc in folders:
        if (doc.get('meta') or {}).get(constants.TypeMarker) not in IMAGE_BEARING_TYPES:
            continue
        root_str = _effective_media_root_id(str(doc['_id']), folders_by_id)
        if root_str in seen_roots:
            continue
        seen_roots.add(root_str)
        root_doc = folders_by_id.get(root_str)
        if root_doc is not None:
            root_id = root_doc['_id']
        else:
            # Clone root outside the annotate set (e.g. source deleted from the
            # marker set): Item.folderId is an ObjectId, so convert the string
            # pointer back before matching, falling back to the raw value.
            try:
                from bson import ObjectId

                root_id = ObjectId(root_str)
            except Exception:
                root_id = root_str  # type: ignore[assignment]
        root_ids.append(root_id)

    image_counts: Dict[Any, int] = {}
    if root_ids:
        from girder.models.item import Item

        if progress is not None:
            progress(f'Counting images in {len(root_ids)} image-bearing dataset folders...')
        rows = _aggregate_id_batches(
            Item().collection,
            _chunked(root_ids, COUNT_ID_CHUNK_SIZE),
            _image_count_pipeline,
            progress=progress,
            stage_label='Image count',
        )
        image_counts = {row['folderId']: int(row.get('n') or 0) for row in rows}
    media = fold_media_counts(folders, image_counts)
    if progress is not None:
        progress(
            f"Media counts ready: {media['videos']} videos, "
            f"{media['imageSequences']} image sequences, {media['images']} images"
        )
    return media, image_counts


def _chunked(items: Sequence[Any], size: int) -> List[Sequence[Any]]:
    """Split ``items`` into contiguous chunks of at most ``size``."""
    if size <= 0:
        raise ValueError('chunk size must be positive')
    return [items[i : i + size] for i in range(0, len(items), size)]


def _count_pipeline(dataset_ids: Sequence[Any]) -> List[Dict[str, Any]]:
    """Cheap live-track counts per dataset (no attribute / confidence work)."""
    return [
        {'$match': _live_track_match(dataset_ids)},
        {'$group': {'_id': '$dataset', 'n': {'$sum': 1}}},
        {'$project': {'_id': 0, 'dataset': '$_id', 'n': 1}},
    ]


def pack_datasets_by_track_budget(
    counts: Sequence[Tuple[Any, int]],
    *,
    track_budget: int = TRACK_BATCH_BUDGET,
    max_datasets: int = MAX_DATASETS_PER_BATCH,
) -> List[List[Any]]:
    """
    Pack dataset IDs into batches capped by live-track volume (and ID count).

    Largest datasets first so big folders tend to land alone or with small ones.
    A single dataset larger than ``track_budget`` becomes its own batch.
    Datasets with ``n <= 0`` are omitted (empty annotate folders).
    """
    if track_budget <= 0:
        raise ValueError('track_budget must be positive')
    if max_datasets <= 0:
        raise ValueError('max_datasets must be positive')

    items = [(dataset, int(n)) for dataset, n in counts if int(n) > 0]
    items.sort(key=lambda pair: pair[1], reverse=True)

    batches: List[List[Any]] = []
    current: List[Any] = []
    current_tracks = 0
    for dataset, n in items:
        would_exceed = bool(current) and (
            current_tracks + n > track_budget or len(current) >= max_datasets
        )
        if would_exceed:
            batches.append(current)
            current = []
            current_tracks = 0
        current.append(dataset)
        current_tracks += n
    if current:
        batches.append(current)
    return batches


def merge_label_counts(batches: Iterable[Iterable[LabelCount]]) -> List[LabelCount]:
    """Sum label counts from batch aggregations; sort by count desc, label asc."""
    totals: Counter[str] = Counter()
    for batch in batches:
        for row in batch:
            label = row.get('label')
            if not isinstance(label, str):
                continue
            totals[label] += int(row.get('count') or 0)
    return [
        {'label': label, 'count': count}
        for label, count in sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def _aggregate_id_batches(
    collection: Any,
    id_batches: Sequence[Sequence[Any]],
    pipeline_fn: Callable[[Sequence[Any]], List[Dict[str, Any]]],
    *,
    progress: Optional[ProgressCallback],
    stage_label: str,
) -> List[Dict[str, Any]]:
    """Run ``pipeline_fn`` over pre-built ID batches; concatenate cursor results."""
    if not id_batches:
        return []
    total_batches = len(id_batches)
    rows: List[Dict[str, Any]] = []
    for index, chunk in enumerate(id_batches, start=1):
        if progress is not None:
            progress(f'{stage_label} batch {index}/{total_batches} ({len(chunk)} datasets)...')
        with pymongo.timeout(AGGREGATE_BATCH_TIMEOUT_S):
            batch_rows = list(collection.aggregate(pipeline_fn(chunk), allowDiskUse=True))
        rows.extend(batch_rows)
    return rows


def _count_tracks_by_dataset(
    collection: Any,
    folder_ids: Sequence[Any],
    *,
    progress: Optional[ProgressCallback],
) -> List[Tuple[Any, int]]:
    """Return ``(dataset_id, live_track_count)`` for annotate folders with tracks."""
    id_chunks = _chunked(folder_ids, COUNT_ID_CHUNK_SIZE)
    if progress is not None:
        progress(f'Counting live tracks per dataset ({len(id_chunks)} chunks)...')
    rows = _aggregate_id_batches(
        collection,
        id_chunks,
        _count_pipeline,
        progress=progress,
        stage_label='Track count',
    )
    counts = [(row['dataset'], int(row.get('n') or 0)) for row in rows]
    if progress is not None:
        total_tracks = sum(n for _, n in counts)
        progress(
            f'Track counts ready: {len(counts)} datasets with tracks, '
            f'{total_tracks} live tracks'
        )
    return counts


def _track_aware_batches(
    collection: Any,
    folder_ids: Sequence[Any],
    *,
    progress: Optional[ProgressCallback],
) -> List[List[Any]]:
    """Count live tracks, then pack dataset IDs by track budget."""
    counts = _count_tracks_by_dataset(collection, folder_ids, progress=progress)
    batches = pack_datasets_by_track_budget(counts)
    if progress is not None:
        progress(
            f'Packed {len(counts)} datasets into {len(batches)} track-aware batches '
            f'(budget={TRACK_BATCH_BUDGET} tracks, max {MAX_DATASETS_PER_BATCH} datasets)'
        )
    return batches


def compute_annotation_stats(
    *,
    dataset_rows: Optional[Iterable[DatasetTrackRow]] = None,
    labels: Optional[Iterable[LabelCount]] = None,
    dataset_folder_total: Optional[int] = None,
    media_counts: Optional[MediaCounts] = None,
    active_users: Optional[ActiveUsersCounts] = None,
    curation_breakdown: Optional[Dict[str, CurationClassBreakdown]] = None,
    now: Optional[datetime] = None,
    progress: Optional[ProgressCallback] = None,
) -> AnnotationStatsReport:
    """
    Build the annotation stats report.

    Optional kwargs allow unit tests to inject precomputed rows without Mongo.
    Girder models are imported lazily so pure helpers stay importable in unit tests.
    ``progress`` receives human-readable stage messages for job logs.

    Live Mongo path counts tracks per dataset, packs ID batches by track volume,
    then runs curated aggregations so large folders cannot starve a fixed-size chunk.
    """

    def _progress(message: str) -> None:
        if progress is not None:
            progress(message)

    folder_ids: Optional[List[Any]] = None
    folder_docs: Optional[List[Dict[str, Any]]] = None
    id_batches: Optional[List[List[Any]]] = None
    if dataset_folder_total is None or dataset_rows is None or labels is None:
        _progress('Counting annotate dataset folders...')
        folder_docs = _annotate_folders()
        folder_ids = [doc['_id'] for doc in folder_docs]
        if dataset_folder_total is None:
            dataset_folder_total = len(folder_ids)
        _progress(f'Found {dataset_folder_total} dataset folders')

    if dataset_rows is None or labels is None:
        from dive_server.crud_annotation import TrackItem

        assert folder_ids is not None
        id_batches = _track_aware_batches(
            TrackItem().collection,
            folder_ids,
            progress=progress,
        )

    if dataset_rows is None:
        from dive_server.crud_annotation import TrackItem

        assert id_batches is not None
        _progress(
            'Aggregating live tracks by dataset '
            '(confidence / userCreated / detection counts; track-aware batches)...'
        )
        dataset_rows = _aggregate_id_batches(
            TrackItem().collection,
            id_batches,
            _dataset_track_pipeline,
            progress=progress,
            stage_label='Track aggregation',
        )
        _progress(f'Track aggregation done: {len(dataset_rows)} datasets with tracks')
    else:
        dataset_rows = list(dataset_rows)

    _progress('Classifying datasets (manual / corrected / computed / empty)...')
    folded = fold_dataset_rows(dataset_rows, dataset_folder_total)
    _progress(
        'Classification done: '
        f"mostlyManual={folded['datasets']['mostlyManual']}, "
        f"mixedSubstantialCorrections="
        f"{folded['datasets']['mixedSubstantialCorrections']}, "
        f"mostlyComputed={folded['datasets']['mostlyComputed']}, "
        f"empty={folded['datasets']['empty']}; "
        f"tracks={folded['tracks']['total']}, "
        f"confidenceGte1={folded['tracks']['confidenceGte1']}, "
        f"detections={folded['tracks']['detections']}"
    )

    image_counts: Optional[Dict[Any, int]] = None
    if folder_docs is not None:
        # Reuse the folder docs already fetched above: type counts are
        # free, and images need just one chunked Item aggregation. Fetch it
        # even when media totals were injected so the per-class breakdown
        # can attribute videos / image sequences / images to each class.
        computed_media, image_counts = _compute_media_counts_and_images(
            folder_docs, progress=progress
        )
        if media_counts is None:
            media_counts = computed_media
    elif media_counts is None:
        # Fully-injected (unit test) path: no Mongo access.
        media_counts = {'videos': 0, 'imageSequences': 0, 'images': 0}

    if curation_breakdown is None:
        assert dataset_rows is not None
        _progress('Folding per-class breakdown (geometry / full-frame / media)...')
        curation_breakdown = fold_curation_breakdown(
            dataset_rows,
            dataset_folder_total,
            folders=folder_docs,
            image_counts_by_folder=image_counts,
        )

    if labels is None:
        from dive_server.crud_annotation import TrackItem

        assert id_batches is not None
        _progress('Aggregating label totals from confidence pairs (track-aware batches)...')
        label_rows = _aggregate_id_batches(
            TrackItem().collection,
            id_batches,
            _label_pipeline,
            progress=progress,
            stage_label='Label aggregation',
        )
        labels = merge_label_counts([label_rows])
        _progress(f'Label aggregation done: {len(labels)} distinct labels')
    else:
        labels = list(labels)

    if active_users is None:
        if folder_docs is not None:
            active_users = _compute_active_users(
                now=now or datetime.now(timezone.utc),
                progress=progress,
            )
        else:
            # Fully-injected (unit test) path: no Mongo access.
            active_users = _empty_active_users()

    _progress('Building report payload...')
    return {
        'generatedAt': (
            _as_utc(now) if now is not None else datetime.now(timezone.utc)
        ).isoformat(),
        'datasets': folded['datasets'],
        'tracks': folded['tracks'],
        'media': media_counts,
        'labels': labels,
        'activeUsers': active_users,
        'curationBreakdown': curation_breakdown,
    }


def annotation_stats_folder(user: types.GirderUserModel) -> types.GirderModel:
    """Ensure the admin user has a private Stats folder for inventory reports."""
    from girder.models.folder import Folder

    return Folder().createFolder(
        user,
        constants.AnnotationStatsFolderName,
        description='Admin annotation inventory reports.',
        parentType='user',
        public=False,
        creator=user,
        reuseExisting=True,
    )


def _upload_json_file(
    user: types.GirderUserModel,
    folder: types.GirderModel,
    name: str,
    payload: bytes,
) -> types.GirderModel:
    from girder.models.item import Item
    from girder.models.upload import Upload

    existing = Item().findOne({'folderId': folder['_id'], 'name': name})
    if existing:
        Item().remove(existing)
    return Upload().uploadFromFile(
        BytesIO(payload),
        len(payload),
        name,
        parentType='folder',
        parent=folder,
        user=user,
        mimeType='application/json',
    )


def save_annotation_stats_report(
    user: types.GirderUserModel,
    report: AnnotationStatsReport,
) -> Dict[str, str]:
    """
    Persist the report under the user's Stats folder.

    Writes ``annotation-stats-latest.json`` (overwritten each run) and a
    timestamped archive copy for history.
    """
    folder = annotation_stats_folder(user)
    payload = json.dumps(report, indent=2).encode('utf-8')
    latest = _upload_json_file(user, folder, ANNOTATION_STATS_LATEST, payload)
    stamp = report['generatedAt'].replace(':', '-').replace('+', '_')
    archive_name = f'annotation-stats-{stamp}.json'
    archive = _upload_json_file(user, folder, archive_name, payload)
    return {
        'folderId': str(folder['_id']),
        'latestItemId': str(latest.get('itemId') or latest.get('_id')),
        'archiveItemId': str(archive.get('itemId') or archive.get('_id')),
        'folderName': constants.AnnotationStatsFolderName,
        'latestFileName': ANNOTATION_STATS_LATEST,
    }


def _load_report_from_stats_folder(
    user: types.GirderUserModel,
) -> Optional[AnnotationStatsReport]:
    """Load ``annotation-stats-latest.json`` from the user's Stats folder, if present."""
    from girder.exceptions import GirderException
    from girder.models.file import File
    from girder.models.folder import Folder
    from girder.models.item import Item

    folder = Folder().findOne(
        {
            'parentId': user['_id'],
            'parentCollection': 'user',
            'name': constants.AnnotationStatsFolderName,
        }
    )
    if not folder:
        return None
    item = Item().findOne({'folderId': folder['_id'], 'name': ANNOTATION_STATS_LATEST})
    if not item:
        return None
    files = list(Item().childFiles(item, limit=1))
    if not files:
        Item().remove(item)
        return None
    try:
        with File().open(files[0]) as handle:
            data = json.loads(handle.read().decode('utf-8'))
    except (GirderException, OSError, ValueError, json.JSONDecodeError):
        # Orphaned DB record or corrupt JSON — drop it so a fresh job can rewrite.
        Item().remove(item)
        return None
    return data  # type: ignore[return-value]


def _load_report_from_latest_job(
    user: types.GirderUserModel,
) -> Optional[AnnotationStatsReport]:
    """Fall back to ``meta.annotationStats`` on the user's newest successful stats job."""
    from girder_jobs.models.job import Job, JobStatus

    job = Job().findOne(
        {
            'userId': user['_id'],
            'type': 'Annotation Stats',
            'status': JobStatus.SUCCESS,
            'meta.annotationStats': {'$exists': True},
        },
        sort=[('created', -1)],
    )
    if not job:
        return None
    report = (job.get('meta') or {}).get('annotationStats')
    return report if isinstance(report, dict) else None


def load_latest_annotation_stats_report(
    user: types.GirderUserModel,
) -> Optional[AnnotationStatsReport]:
    """
    Return the newest annotation inventory report for ``user``.

    Prefers the Stats-folder JSON file; if that is missing, uses the latest
    successful Annotation Stats job meta so Admin Stats can still download after
    refresh.
    """
    return _load_report_from_stats_folder(user) or _load_report_from_latest_job(user)
