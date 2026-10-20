from dive_server.crud_annotation_stats import (
    MAX_DATASETS_PER_BATCH,
    TRACK_BATCH_BUDGET,
    DatasetTrackRow,
    _chunked,
    _count_pipeline,
    _dataset_track_pipeline,
    _image_count_pipeline,
    _label_pipeline,
    _live_track_match,
    classify_dataset_row,
    compute_annotation_stats,
    fold_dataset_rows,
    fold_media_counts,
    merge_label_counts,
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


def test_classify_mostly_manual_requires_min_tracks():
    assert classify_dataset_row(_row(total=4, manual=4, confidenceGte1=4)) == 'mostlyComputed'


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
