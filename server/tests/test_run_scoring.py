from pathlib import Path

from dive_tasks import run_scoring, utils
from dive_tasks.run_scoring import build_score_args, download_pair_inputs
from dive_utils.scoring import DEFAULT_SCORING_PARAMS, headline_metrics, result_summary

PATHS = {
    'computed': '/work/input/computed',
    'truth': '/work/input/truth',
    'metricsOut': '/work/metrics.json',
    'matchesOut': '/work/matches.json',
    'sweepDir': '/work/sweep',
}


def test_default_params_produce_the_client_argument_list():
    assert build_score_args(DEFAULT_SCORING_PARAMS, PATHS) == [
        '-c',
        '/work/input/computed',
        '-t',
        '/work/input/truth',
        '--input-ext',
        '.csv',
        '-o',
        '/work/metrics.json',
        '--json-curves',
        '--iou',
        '0.5',
        '--conf',
        '0.0',
        '--match-mode',
        'box',
        '--keypoint-threshold',
        '0.1',
        '--per-class',
        '--output-matches',
        '/work/matches.json',
        '--sweep-thresholds',
        '--sweep-interval',
        '50',
        '--filter-estimator',
        'min',
        '--output-sweep',
        '/work/sweep',
    ]


def test_missing_params_fall_back_to_defaults():
    assert build_score_args({}, PATHS) == build_score_args(DEFAULT_SCORING_PARAMS, PATHS)


def test_sweep_flags_only_when_sweep_is_on():
    args = build_score_args({**DEFAULT_SCORING_PARAMS, 'sweep': False}, PATHS)
    assert '--sweep-thresholds' not in args
    assert '--sweep-interval' not in args
    assert '--filter-estimator' not in args
    assert '--output-sweep' not in args


def test_no_tracking_when_tracking_is_off():
    assert '--no-tracking' not in build_score_args(DEFAULT_SCORING_PARAMS, PATHS)
    assert '--no-tracking' in build_score_args({**DEFAULT_SCORING_PARAMS, 'tracking': False}, PATHS)


def test_labels_only_with_a_labels_file():
    assert '--labels' not in build_score_args(DEFAULT_SCORING_PARAMS, PATHS)
    args = build_score_args(DEFAULT_SCORING_PARAMS, {**PATHS, 'labelsFile': '/work/labels.txt'})
    assert args[args.index('--labels') + 1] == '/work/labels.txt'


def test_polygon_match_mode():
    args = build_score_args({**DEFAULT_SCORING_PARAMS, 'matchMode': 'polygon'}, PATHS)
    assert args[args.index('--match-mode') + 1] == 'polygon'


def test_optional_flags():
    params = {
        **DEFAULT_SCORING_PARAMS,
        'perClass': False,
        'topClass': True,
        'auxConfidence': True,
        'defaultLabel': 'fish',
    }
    args = build_score_args(params, PATHS)
    assert '--per-class' not in args
    assert '--top-class' in args
    assert '--aux-confidence' in args
    assert args[args.index('--defaultlabel') + 1] == 'fish'


def test_matches_output_omitted_without_a_path():
    paths = {key: value for key, value in PATHS.items() if key != 'matchesOut'}
    assert '--output-matches' not in build_score_args(DEFAULT_SCORING_PARAMS, paths)


def test_pair_inputs_share_a_basename_across_the_two_folders(tmp_path: Path, monkeypatch):
    downloads = []

    def fake_download(gc, dataset_id, path, revision=None, set=None):
        downloads.append((dataset_id, Path(path), revision, set))
        Path(path).write_text('', encoding='utf-8')

    monkeypatch.setattr(utils, 'download_annotation_csv', fake_download)
    pairs = [
        {'computed': {'datasetId': 'a', 'set': 'detector'}, 'truth': {'datasetId': 'a'}},
        {'computed': {'datasetId': 'b', 'revision': 3}, 'truth': {'datasetId': 'c', 'set': 'gt'}},
    ]

    computed_dir, truth_dir = download_pair_inputs(object(), pairs, tmp_path)

    assert computed_dir == tmp_path / 'computed'
    assert truth_dir == tmp_path / 'truth'
    assert downloads == [
        ('a', computed_dir / 'seq_000.csv', None, 'detector'),
        ('a', truth_dir / 'seq_000.csv', None, None),
        ('b', computed_dir / 'seq_001.csv', 3, None),
        ('c', truth_dir / 'seq_001.csv', None, 'gt'),
    ]
    assert sorted(p.name for p in computed_dir.iterdir()) == ['seq_000.csv', 'seq_001.csv']
    assert sorted(p.name for p in truth_dir.iterdir()) == ['seq_000.csv', 'seq_001.csv']


def test_input_ext_matches_the_downloaded_files():
    assert build_score_args({}, PATHS)[5] == run_scoring.INPUT_EXT == '.csv'


def test_headline_metrics_keeps_finite_numbers_only():
    raw = {
        'precision': 0.75,
        'recall': None,
        'f1_score': float('nan'),
        'mota': True,
        'true_positives': 12,
        'per_class': {'fish': {'precision': 1.0}},
    }
    assert headline_metrics(raw) == {
        'precision': 0.75,
        'recall': None,
        'f1_score': None,
        'mota': None,
        'true_positives': 12,
    }


def test_result_summary_drops_payloads():
    pairs = [
        {'computed': {'datasetId': 'a', 'set': 'detector'}, 'truth': {'datasetId': 'b'}},
        {'computed': {'datasetId': 'c'}, 'truth': {'datasetId': 'c', 'set': 'gt'}},
    ]
    result = {
        'version': 1,
        'id': '',
        'datasetId': 'a',
        'created': '2026-09-06T12:00:00+00:00',
        'title': 'a vs b (+1 more)',
        'pairs': pairs,
        'params': DEFAULT_SCORING_PARAMS,
        'metrics': {'precision': 0.5, 'pr_curve': {'points': []}},
        'matches': {'columns': [], 'frame_names': [], 'rows': []},
        'summaryText': '--- Detection Metrics ---',
    }
    assert result_summary(result) == {
        'created': '2026-09-06T12:00:00+00:00',
        'title': 'a vs b (+1 more)',
        'datasetId': 'a',
        'pairs': pairs,
        'params': DEFAULT_SCORING_PARAMS,
        'headline': {'precision': 0.5},
    }
