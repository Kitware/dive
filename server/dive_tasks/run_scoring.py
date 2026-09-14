from contextlib import suppress
from datetime import datetime, timezone
import json
from pathlib import Path
import shlex
import tempfile
from typing import Any, Dict, List, Tuple

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.manager import patch_manager
from dive_tasks.viame_config import Config
from dive_utils import constants
from dive_utils.scoring import (
    DEFAULT_SCORING_PARAMS,
    SCORING_RESULT_META,
    SCORING_RESULT_VERSION,
    result_summary,
)
from dive_utils.types import ScoringJob, ScoringPairJob

INPUT_EXT = '.csv'


def build_score_args(params: Dict[str, Any], paths: Dict[str, str]) -> List[str]:
    """Unquoted ``viame score`` arguments; mirrors scoringCliArgs in metrics.ts.

    ``paths`` carries ``computed`` and ``truth`` (a file each, or a folder each
    whose files pair by basename), ``metricsOut``, plus optional ``matchesOut``,
    ``sweepDir`` and ``labelsFile``.
    """
    p = {**DEFAULT_SCORING_PARAMS, **params}
    args = [
        '-c',
        paths['computed'],
        '-t',
        paths['truth'],
        '--input-ext',
        INPUT_EXT,
        '-o',
        paths['metricsOut'],
        '--json-curves',
        '--iou',
        str(p['iouThreshold']),
        '--conf',
        str(p['confidenceThreshold']),
        '--match-mode',
        str(p['matchMode']),
        '--keypoint-threshold',
        str(p['keypointThreshold']),
    ]
    if p['perClass']:
        args.append('--per-class')
    if p['topClass']:
        args.append('--top-class')
    if p['auxConfidence']:
        args.append('--aux-confidence')
    if not p['tracking']:
        args.append('--no-tracking')
    if p.get('defaultLabel'):
        args += ['--defaultlabel', str(p['defaultLabel'])]
    if paths.get('labelsFile'):
        args += ['--labels', paths['labelsFile']]
    if paths.get('matchesOut'):
        args += ['--output-matches', paths['matchesOut']]
    if p['sweep']:
        args += ['--sweep-thresholds', '--sweep-interval', str(int(p['sweepInterval']))]
        args += ['--filter-estimator', str(p['filterEstimator'])]
        if paths.get('sweepDir'):
            args += ['--output-sweep', paths['sweepDir']]
    return args


def download_pair_inputs(
    gc: GirderClient, pairs: List[ScoringPairJob], input_path: Path
) -> Tuple[Path, Path]:
    """Fetch every pair's CSVs into a computed folder and a truth folder.

    ``viame score`` pairs the files of two folders by basename, so pair ``i``
    is ``seq_<i>.csv`` on both sides; its index is the matches' sequence index.
    """
    computed_dir = utils.make_directory(input_path / 'computed')
    truth_dir = utils.make_directory(input_path / 'truth')
    for index, pair in enumerate(pairs):
        name = f'seq_{index:03d}{INPUT_EXT}'
        for source, directory in ((pair['computed'], computed_dir), (pair['truth'], truth_dir)):
            utils.download_annotation_csv(
                gc,
                source['datasetId'],
                directory / name,
                revision=source.get('revision'),
                set=source.get('set'),
            )
    return computed_dir, truth_dir


def _read_json(path: Path) -> Any:
    with open(path, 'r', encoding='utf-8') as fh:
        return json.load(fh)


@app.task(bind=True, acks_late=True, ignore_result=True)
def run_scoring(self: Task, params: ScoringJob):
    """Score a list of sequence pairs together with ``viame score``."""
    conf = Config()
    conf.require_viame_install()
    context: dict = {}
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    gc: GirderClient = self.girder_client
    utils.authenticate_urllib(gc)
    manager.updateStatus(JobStatus.FETCHING_INPUT)

    pairs = params['pairs']
    scoring_params = {**DEFAULT_SCORING_PARAMS, **(params.get('params') or {})}
    results_folder_id = params['results_folder_id']
    title = params['title']

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        working_directory = Path(_working_directory)
        input_path = utils.make_directory(working_directory / 'input')
        output_path = utils.make_directory(working_directory / 'output')

        computed_dir, truth_dir = download_pair_inputs(gc, pairs, input_path)

        paths = {
            'computed': str(computed_dir),
            'truth': str(truth_dir),
            'metricsOut': str(output_path / 'metrics.json'),
            'matchesOut': str(output_path / 'matches.json'),
            'sweepDir': str(utils.make_directory(output_path / 'sweep')),
        }
        label_synonyms = scoring_params.get('labelSynonyms')
        if label_synonyms:
            labels_path = input_path / 'labels.txt'
            labels_path.write_text(label_synonyms, encoding='utf-8')
            paths['labelsFile'] = str(labels_path)

        command = [
            f". {shlex.quote(str(conf.viame_setup_script))} &&",
            f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
            f"{shlex.quote(str(conf.viame_executable))} score",
            *(shlex.quote(arg) for arg in build_score_args(scoring_params, paths)),
        ]

        manager.updateStatus(JobStatus.RUNNING)
        popen_kwargs = {
            'args': " ".join(command),
            'shell': True,
            'executable': '/bin/bash',
            'cwd': output_path,
            'env': conf.gpu_process_env,
        }
        summary_text = utils.stream_subprocess(
            self, context, manager, popen_kwargs, keep_stdout=True
        )

        metrics_path = Path(paths['metricsOut'])
        if not metrics_path.is_file():
            raise RuntimeError(
                'viame score finished without writing metrics.json; see the job log above'
            )
        metrics = _read_json(metrics_path)
        matches_path = Path(paths['matchesOut'])
        matches = _read_json(matches_path) if matches_path.is_file() else None

        created = datetime.now(timezone.utc)
        result: Dict[str, Any] = {
            'version': SCORING_RESULT_VERSION,
            'id': '',
            'datasetId': results_folder_id,
            'created': created.isoformat(),
            'title': title,
            'pairs': pairs,
            'params': scoring_params,
            'metrics': metrics,
            'summaryText': summary_text,
        }
        if matches is not None:
            result['matches'] = matches

        result_path = output_path / f"scoring_{created.strftime('%Y%m%d_%H%M%S')}.json"
        with open(result_path, 'w', encoding='utf-8') as fh:
            json.dump(result, fh)

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        auxiliary = gc.createFolder(
            results_folder_id, constants.AuxiliaryFolderName, reuseExisting=True
        )
        uploaded = gc.uploadFileToFolder(auxiliary['_id'], str(result_path))
        gc.addMetadataToItem(uploaded['itemId'], {SCORING_RESULT_META: result_summary(result)})
