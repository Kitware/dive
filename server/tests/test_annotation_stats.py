from dive_server.crud_annotation_stats import (
    DatasetTrackRow,
    classify_dataset_row,
    compute_annotation_stats,
    fold_dataset_rows,
)


def _row(**overrides) -> DatasetTrackRow:
    base: DatasetTrackRow = {
        'dataset': 'ds',
        'total': 0,
        'manual': 0,
        'conf1NonManual': 0,
        'confidenceGte1': 0,
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
        ),
        _row(
            dataset='b',
            total=100,
            manual=0,
            conf1NonManual=30,
            confidenceGte1=30,
        ),
        _row(
            dataset='c',
            total=50,
            manual=0,
            confidenceGte1=0,
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


def test_compute_annotation_stats_with_injected_rows():
    report = compute_annotation_stats(
        dataset_rows=[
            _row(dataset='a', total=10, manual=10, confidenceGte1=10),
        ],
        labels=[{'label': 'fish', 'count': 7}, {'label': 'shark', 'count': 3}],
        dataset_folder_total=3,
    )
    assert report['datasets']['total'] == 3
    assert report['datasets']['mostlyManual'] == 1
    assert report['datasets']['empty'] == 2
    assert report['tracks']['total'] == 10
    assert report['tracks']['confidenceGte1'] == 10
    assert report['labels'][0]['label'] == 'fish'
    assert report['generatedAt']
