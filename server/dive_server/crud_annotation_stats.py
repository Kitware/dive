"""Admin annotation inventory stats (datasets / tracks / labels / curation classes)."""

from collections import Counter
from datetime import datetime, timezone
from io import BytesIO
import json
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple, TypedDict

import pymongo

from dive_utils import TRUTHY_META_VALUES, constants, types

ProgressCallback = Callable[[str], None]

ANNOTATION_STATS_LATEST = constants.AnnotationStatsLatestFileName

# Classification thresholds (aligned with admin Mongo sketches)
MIN_MANUAL_TRACKS = 5
MANUAL_FRAC = 0.9
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


class LabelCount(TypedDict):
    label: str
    count: int


class AnnotationStatsReport(TypedDict):
    generatedAt: str
    datasets: DatasetKindCounts
    tracks: TrackCounts
    labels: List[LabelCount]


class DatasetTrackRow(TypedDict):
    """Per-dataset live-track counters from the trackItem aggregation."""

    dataset: Any
    total: int
    manual: int
    # Non-manual tracks whose first confidence pair is >= 1 (accept / type-set proxy)
    conf1NonManual: int
    confidenceGte1: int


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

    if total >= MIN_MANUAL_TRACKS and manual_frac >= MANUAL_FRAC:
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
    }
    datasets_with_tracks = 0

    for row in rows:
        total = int(row.get('total') or 0)
        if total <= 0:
            continue
        datasets_with_tracks += 1
        tracks['total'] += total
        tracks['confidenceGte1'] += int(row.get('confidenceGte1') or 0)
        kind = classify_dataset_row(row)
        datasets[kind] = datasets[kind] + 1  # type: ignore[literal-required]

    empty = max(int(dataset_folder_total) - datasets_with_tracks, 0)
    datasets['empty'] = empty
    return {'datasets': datasets, 'tracks': tracks}


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


def _dataset_track_pipeline(dataset_ids: Sequence[Any]) -> List[Dict[str, Any]]:
    """Aggregate live tracks per dataset with curation signals.

    Only reads ``attributes`` / ``confidencePairs`` — not ``features`` — so the
    scan stays viable on very large ``trackItem`` collections. Scoped to
    ``dataset_ids`` so Mongo can use the existing (dataset, …) index.
    """
    return [
        {'$match': _live_track_match(dataset_ids)},
        {
            '$project': {
                '_id': 0,
                'dataset': 1,
                'userCreated': {'$eq': ['$attributes.userCreated', True]},
                'firstConf': {'$arrayElemAt': [{'$arrayElemAt': ['$confidencePairs', 0]}, 1]},
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


def _annotate_folder_ids() -> List[Any]:
    """Return ``_id``s of all annotate dataset folders."""
    from girder.models.folder import Folder

    return [doc['_id'] for doc in Folder().find(_annotate_folder_query(), fields={'_id': 1})]


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
    id_batches: Optional[List[List[Any]]] = None
    if dataset_folder_total is None or dataset_rows is None or labels is None:
        _progress('Counting annotate dataset folders...')
        folder_ids = _annotate_folder_ids()
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
            '(confidence / userCreated only; track-aware batches)...'
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
        f"confidenceGte1={folded['tracks']['confidenceGte1']}"
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

    _progress('Building report payload...')
    return {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'datasets': folded['datasets'],
        'tracks': folded['tracks'],
        'labels': labels,
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
