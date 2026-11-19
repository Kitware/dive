from datetime import datetime, timedelta, timezone

from dive_server.crud_annotation_stats import (
    ACTIVE_USER_WINDOWS,
    MANUAL_FRAC,
    MAX_DATASETS_PER_BATCH,
    MOSTLY_MANUAL_TRACK_THRESHOLD,
    TRACK_BATCH_BUDGET,
    DatasetTrackRow,
    _chunked,
    _count_pipeline,
    _dataset_track_pipeline,
    _dataset_uploader_pipeline,
    _detection_stats_expr,
    _image_count_pipeline,
    _label_pipeline,
    _live_track_match,
    _track_editor_pipeline,
    classify_dataset_row,
    compute_annotation_stats,
    fold_active_users,
    fold_curation_breakdown,
    fold_dataset_rows,
    fold_media_counts,
    merge_label_counts,
    merge_latest_activity,
    pack_datasets_by_track_budget,
)


def _row(**overrides) -> DatasetTrackRow:
    base: DatasetTrackRow = {
        'dataset': 'ds',
        'total': 0,
        'manual': 0,
        'conf1NonManual': 0,
        'confidenceGte1': 0,
        'detections': 0,
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


def test_classify_mostly_manual():
    assert classify_dataset_row(_row(total=20, manual=19, confidenceGte1=19)) == 'mostlyManual'


def test_classify_mostly_manual_thresholds():
    assert MANUAL_FRAC == 0.25
    assert MOSTLY_MANUAL_TRACK_THRESHOLD == 10
    # Exactly 25% manual in a dataset with more than 10 tracks qualifies.
    assert classify_dataset_row(_row(total=20, manual=5)) == 'mostlyManual'
    assert classify_dataset_row(_row(total=11, manual=3)) == 'mostlyManual'
    # Below 25% manual in a larger dataset does not.
    assert classify_dataset_row(_row(total=20, manual=4)) == 'mostlyComputed'


def test_classify_mostly_manual_small_all_manual():
    # Small datasets (<= 10 tracks) qualify only when every track is manual;
    # the 10-track all-manual case is not stranded between the two arms.
    assert classify_dataset_row(_row(total=4, manual=4, confidenceGte1=4)) == 'mostlyManual'
    assert classify_dataset_row(_row(total=10, manual=10)) == 'mostlyManual'
    assert classify_dataset_row(_row(total=10, manual=9)) == 'mostlyComputed'
    assert classify_dataset_row(_row(total=8, manual=7)) == 'mostlyComputed'
    assert classify_dataset_row(_row(total=5, manual=2)) == 'mostlyComputed'


def test_classify_mixed_substantial_corrections():
    assert (
        classify_dataset_row(
            _row(
                total=100,
                manual=5,
                conf1NonManual=30,
                confidenceGte1=35,
            )
        )
        == 'mixedSubstantialCorrections'
    )


def test_classify_mixed_needs_enough_corrected():
    # 10 corrected of 95 computed is ~10.5%, below 25% and below absolute 15
    assert (
        classify_dataset_row(
            _row(
                total=100,
                manual=5,
                conf1NonManual=10,
                confidenceGte1=10,
            )
        )
        == 'mostlyComputed'
    )


def test_fold_dataset_rows_totals_and_empty():
    rows = [
        _row(
            dataset='a',
            total=20,
            manual=20,
            confidenceGte1=20,
            detections=40,
        ),
        _row(
            dataset='b',
            total=100,
            manual=0,
            conf1NonManual=30,
            confidenceGte1=30,
            detections=250,
        ),
        _row(
            dataset='c',
            total=50,
            manual=0,
            confidenceGte1=0,
            detections=50,
        ),
    ]
    folded = fold_dataset_rows(rows, dataset_folder_total=5)
    assert folded['datasets']['total'] == 5
    assert folded['datasets']['mostlyManual'] == 1
    assert folded['datasets']['mixedSubstantialCorrections'] == 1
    assert folded['datasets']['mostlyComputed'] == 1
    assert folded['datasets']['empty'] == 2
    assert folded['tracks']['total'] == 170
    assert folded['tracks']['confidenceGte1'] == 50
    assert folded['tracks']['detections'] == 340


def test_fold_curation_breakdown_attributes_geometry_and_media():
    rows = [
        _row(
            dataset='manual-ds',
            total=20,
            manual=20,
            confidenceGte1=20,
            detections=40,
            detectionsWithPolygon=10,
            detectionsWithPoint=4,
            detectionsWithLineString=2,
            detectionsWithGeometry=12,
            detectionsBoundsOnly=28,
            fullFrameDetections=3,
            tracksWithPolygon=6,
            tracksWithPoint=3,
            tracksWithLineString=1,
            tracksWithGeometry=7,
            tracksBoundsOnly=13,
            tracksFullFrame=2,
        ),
        _row(
            dataset='computed-ds',
            total=50,
            manual=0,
            confidenceGte1=0,
            detections=50,
            detectionsBoundsOnly=50,
            tracksBoundsOnly=50,
        ),
    ]
    folders = [
        _folder('manual-ds', 'video'),
        _folder('computed-ds', 'image-sequence'),
        _folder('empty-ds', 'video'),
    ]
    breakdown = fold_curation_breakdown(
        rows, dataset_folder_total=3, folders=folders, image_counts_by_folder={'computed-ds': 12}
    )
    manual = breakdown['mostlyManual']
    assert manual['datasets'] == 1
    assert manual['tracks'] == 20
    assert manual['detections'] == 40
    assert manual['manualTracks'] == 20
    assert manual['geometryTypes'] == {
        'Polygon': 10,
        'Point': 4,
        'LineString': 2,
        'boundingBoxOnly': 28,
    }
    assert manual['detectionsWithPolygon'] == 10
    assert manual['tracksWithPolygon'] == 6
    assert manual['fullFrameDetections'] == 3
    assert manual['tracksFullFrame'] == 2
    assert manual['media'] == {'videos': 1, 'imageSequences': 0, 'images': 0}
    computed = breakdown['mostlyComputed']
    assert computed['tracks'] == 50
    assert computed['detectionsBoundsOnly'] == 50
    assert computed['media'] == {'videos': 0, 'imageSequences': 1, 'images': 12}
    assert breakdown['empty']['datasets'] == 1
    assert breakdown['empty']['media'] == {'videos': 1, 'imageSequences': 0, 'images': 0}
    # Per-class media sums to the report-wide folding of the same folders.
    totals = fold_media_counts(folders, {'computed-ds': 12})
    for key in ('videos', 'imageSequences', 'images'):
        assert sum(entry['media'][key] for entry in breakdown.values()) == totals[key]


def test_fold_curation_breakdown_without_folders_has_zero_media():
    breakdown = fold_curation_breakdown(
        [_row(dataset='a', total=10, manual=10, detections=33)], dataset_folder_total=3
    )
    assert breakdown['mostlyManual']['tracks'] == 10
    assert breakdown['mostlyManual']['media'] == {
        'videos': 0,
        'imageSequences': 0,
        'images': 0,
    }
    assert breakdown['empty']['datasets'] == 2


def test_compute_annotation_stats_includes_curation_breakdown():
    report = compute_annotation_stats(
        dataset_rows=[
            _row(
                dataset='a',
                total=10,
                manual=10,
                confidenceGte1=10,
                detections=33,
                detectionsWithPolygon=5,
                tracksWithPolygon=2,
            )
        ],
        labels=[],
        dataset_folder_total=3,
    )
    assert report['curationBreakdown']['mostlyManual']['detectionsWithPolygon'] == 5
    assert report['curationBreakdown']['mostlyManual']['tracksWithPolygon'] == 2
    assert report['curationBreakdown']['empty']['datasets'] == 2


def test_dataset_track_pipeline_counts_geometry_per_detection():
    pipeline = _dataset_track_pipeline(['ds1'])
    project = pipeline[1]['$project']
    det_stats = project['detStats']['$reduce']
    assert det_stats['initialValue'] == {
        'withPolygon': 0,
        'withPoint': 0,
        'withLineString': 0,
        'withGeometry': 0,
        'boundsOnly': 0,
        'fullFrame': 0,
    }
    group = pipeline[2]['$group']
    assert group['detectionsWithPolygon'] == {'$sum': '$detStats.withPolygon'}
    assert group['fullFrameDetections'] == {'$sum': '$detStats.fullFrame'}
    assert group['tracksWithPoint']['$sum']
    final = pipeline[3]['$project']
    assert final['tracksFullFrame'] == 1
    # The $reduce tallies GeoJSON types present on each feature.
    expr = _detection_stats_expr()
    assert expr['$reduce']['input'] == {'$ifNull': ['$features', []]}


def test_compute_annotation_stats_with_injected_rows():
    report = compute_annotation_stats(
        dataset_rows=[
            _row(dataset='a', total=10, manual=10, confidenceGte1=10, detections=33),
        ],
        labels=[{'label': 'fish', 'count': 7}, {'label': 'shark', 'count': 3}],
        dataset_folder_total=3,
        media_counts={'videos': 2, 'imageSequences': 1, 'images': 42},
    )
    assert report['datasets']['total'] == 3
    assert report['datasets']['mostlyManual'] == 1
    assert report['datasets']['empty'] == 2
    assert report['tracks']['total'] == 10
    assert report['tracks']['confidenceGte1'] == 10
    assert report['tracks']['detections'] == 33
    assert report['media'] == {'videos': 2, 'imageSequences': 1, 'images': 42}
    assert report['labels'][0]['label'] == 'fish'
    assert report['generatedAt']


def test_compute_annotation_stats_injected_rows_default_media_without_mongo():
    report = compute_annotation_stats(
        dataset_rows=[_row(dataset='a', total=1, manual=1)],
        labels=[],
        dataset_folder_total=1,
    )
    assert report['media'] == {'videos': 0, 'imageSequences': 0, 'images': 0}
    assert report['tracks']['detections'] == 0
    # Fully-injected path must not touch Mongo for active users either.
    assert report['activeUsers'] == {key: 0 for key, _ in ACTIVE_USER_WINDOWS}


def test_compute_annotation_stats_preserves_injected_active_users():
    active = {
        'lastMonth': 1,
        'last3Months': 2,
        'last6Months': 3,
        'lastYear': 4,
        'last5Years': 5,
    }
    report = compute_annotation_stats(
        dataset_rows=[_row(dataset='a', total=1, manual=1)],
        labels=[],
        dataset_folder_total=1,
        active_users=active,
    )
    assert report['activeUsers'] == active


def test_fold_active_users_counts_each_user_in_nested_windows():
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    latest = {
        'recent': now - timedelta(days=10),
        # Exactly on the boundary counts (windows are inclusive).
        'boundary': now - timedelta(days=30),
        'two-months': now - timedelta(days=45),
        'four-months': now - timedelta(days=120),
        'nine-months': now - timedelta(days=200),
        'two-years': now - timedelta(days=400),
        'four-years': now - timedelta(days=1000),
        'ancient': now - timedelta(days=2000),
        # Mongo returns naive UTC datetimes; those must not crash or be skipped.
        'naive': (now - timedelta(days=5)).replace(tzinfo=None),
    }
    assert fold_active_users(latest, now) == {
        'lastMonth': 3,
        'last3Months': 4,
        'last6Months': 5,
        'lastYear': 6,
        'last5Years': 8,
    }


def test_merge_latest_activity_keeps_newest_across_sources():
    older = datetime(2026, 1, 1, tzinfo=timezone.utc)
    newer = datetime(2026, 9, 1, tzinfo=timezone.utc)
    merged = merge_latest_activity(
        [{'user': 'alice', 'latest': older}, {'user': 'bob', 'latest': older}],
        # Same user as a different id type/string form must merge, not duplicate.
        [{'user': 'alice', 'latest': newer}, {'user': None, 'latest': newer}],
    )
    assert merged == {'alice': newer, 'bob': older}


def test_dataset_uploader_pipeline_groups_latest_upload_per_creator():
    since = datetime(2021, 10, 20, tzinfo=timezone.utc)
    pipeline = _dataset_uploader_pipeline(since)
    match = pipeline[0]['$match']
    assert match['created'] == {'$gte': since}
    assert match['creatorId'] == {'$exists': True, '$ne': None}
    # Only annotate dataset folders count as uploads.
    assert any(key.startswith('meta.') for key in match)
    assert pipeline[1] == {'$group': {'_id': '$creatorId', 'latest': {'$max': '$created'}}}
    assert pipeline[2] == {'$project': {'_id': 0, 'user': '$_id', 'latest': 1}}


def test_track_editor_pipeline_groups_latest_revision_per_author():
    since = datetime(2021, 10, 20, tzinfo=timezone.utc)
    pipeline = _track_editor_pipeline(since)
    assert pipeline[0] == {
        '$match': {
            'created': {'$gte': since},
            'author_id': {'$exists': True, '$ne': None},
        }
    }
    assert pipeline[1] == {'$group': {'_id': '$author_id', 'latest': {'$max': '$created'}}}
    assert pipeline[2] == {'$project': {'_id': 0, 'user': '$_id', 'latest': 1}}


def _folder(folder_id, media_type, **extra):
    doc = {'_id': folder_id, 'meta': {'type': media_type}}
    doc.update(extra)
    return doc


def test_fold_media_counts_counts_logical_media_not_files():
    # A video folder holds an original + transcoded file on disk, but folding
    # is per folder (meta.type), so it is exactly one video either way. The
    # multicam parent (type=multi) counts as neither; each camera does.
    folders = [
        _folder('video-1', 'video'),
        _folder('seq-1', 'image-sequence'),
        _folder('large-1', 'large-image'),
        _folder('multi-parent', 'multi'),
        _folder('cam-left', 'video'),
        _folder('cam-right', 'image-sequence'),
    ]
    media = fold_media_counts(folders, {'seq-1': 10, 'large-1': 1, 'cam-right': 5})
    assert media == {'videos': 2, 'imageSequences': 2, 'images': 16}


def test_fold_media_counts_clone_images_resolve_to_source_root():
    folders = [
        _folder('source', 'image-sequence'),
        _folder('clone', 'image-sequence', foreign_media_id='source'),
        _folder('clone-of-clone', 'image-sequence', foreign_media_id='clone'),
    ]
    media = fold_media_counts(folders, {'source': 7})
    assert media['imageSequences'] == 3
    # Each clone contributes its source's images, like its copied tracks.
    assert media['images'] == 21


def test_fold_media_counts_no_image_counts():
    media = fold_media_counts([_folder('v', 'video'), _folder('s', 'image-sequence')])
    assert media == {'videos': 1, 'imageSequences': 1, 'images': 0}


def test_image_count_pipeline_groups_by_folder():
    ids = ['ds1', 'ds2']
    pipeline = _image_count_pipeline(ids)
    assert pipeline[0]['$match']['folderId'] == {'$in': ids}
    assert pipeline[0]['$match']['lowerName']['$regex']
    assert pipeline[1] == {'$group': {'_id': '$folderId', 'n': {'$sum': 1}}}


def test_dataset_track_pipeline_counts_detections_from_features_size():
    pipeline = _dataset_track_pipeline(['ds1'])
    project = pipeline[1]['$project']
    assert project['detections'] == {'$size': {'$ifNull': ['$features', []]}}
    group = pipeline[2]['$group']
    assert group['detections'] == {'$sum': '$detections'}


def test_live_track_match_scopes_to_dataset_ids():
    ids = ['a', 'b', 'c']
    match = _live_track_match(ids)
    assert match == {
        'dataset': {'$in': ids},
        'rev_deleted': {'$exists': False},
    }


def test_dataset_track_pipeline_match_includes_dataset_in():
    ids = ['ds1', 'ds2']
    pipeline = _dataset_track_pipeline(ids)
    assert pipeline[0] == {'$match': _live_track_match(ids)}


def test_label_pipeline_match_includes_dataset_in():
    ids = ['ds1']
    pipeline = _label_pipeline(ids)
    assert pipeline[0] == {'$match': _live_track_match(ids)}


def test_chunked_splits_evenly_and_remainder():
    assert _chunked([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
    assert _chunked([], 10) == []
    assert _chunked([1, 2], 10) == [[1, 2]]


def test_merge_label_counts_sums_and_sorts():
    merged = merge_label_counts(
        [
            [{'label': 'fish', 'count': 7}, {'label': 'shark', 'count': 3}],
            [{'label': 'fish', 'count': 2}, {'label': 'ray', 'count': 5}],
        ]
    )
    assert merged == [
        {'label': 'fish', 'count': 9},
        {'label': 'ray', 'count': 5},
        {'label': 'shark', 'count': 3},
    ]


def test_count_pipeline_match_includes_dataset_in():
    ids = ['ds1', 'ds2']
    pipeline = _count_pipeline(ids)
    assert pipeline[0] == {'$match': _live_track_match(ids)}
    assert pipeline[1] == {'$group': {'_id': '$dataset', 'n': {'$sum': 1}}}


def test_pack_datasets_by_track_budget_balances_volume():
    counts = [
        ('tiny', 10),
        ('big', 400_000),
        ('medium', 200_000),
        ('empty', 0),
        ('huge', 900_000),
    ]
    batches = pack_datasets_by_track_budget(counts, track_budget=500_000, max_datasets=10)
    # Largest first; over-budget datasets are solo; smaller ones fill remaining room.
    assert batches == [['huge'], ['big'], ['medium', 'tiny']]


def test_pack_datasets_respects_max_datasets():
    counts = [(f'd{i}', 1) for i in range(10)]
    batches = pack_datasets_by_track_budget(counts, track_budget=1_000_000, max_datasets=3)
    assert all(len(batch) <= 3 for batch in batches)
    assert sum(len(batch) for batch in batches) == 10


def test_pack_defaults_are_positive():
    assert TRACK_BATCH_BUDGET > 0
    assert MAX_DATASETS_PER_BATCH > 0
