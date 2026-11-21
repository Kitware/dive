"""Index and query jobs share the pipeline queue and never retain a GPU session."""

from contextlib import suppress
import json
from pathlib import Path
import shlex
import shutil
import tempfile

from girder_worker.app import app
from girder_worker.utils import JobStatus

from dive_tasks import utils
from dive_tasks.manager import patch_manager
from dive_tasks.viame_config import Config
from dive_utils import constants
from dive_utils.query import extract_index


def require_query_install(conf):
    pipelines = conf.viame_install_path / 'configs' / 'pipelines'
    required = [
        conf.viame_install_path / 'configs' / 'index.py',
        pipelines / 'query_retrieval_and_iqr.pipe',
        pipelines / 'query_image_exemplar.pipe',
        pipelines / 'query_and_iqr.pipe',
    ]
    if any(not path.is_file() for path in required):
        raise RuntimeError(
            'Upgrade this worker: VIAME image-query pipelines and index tooling are required.'
        )
    inner = (pipelines / 'query_and_iqr.pipe').read_text()
    active_lines = [line.strip() for line in inner.splitlines() if not line.strip().startswith('#')]
    if not any(line.startswith(':descriptor_index_dir') for line in active_lines) or any(
        line.startswith(':conn_str') for line in active_lines
    ):
        raise RuntimeError(
            'Upgrade this worker to the file-backed query pipeline; '
            'PostgreSQL is not supported for web queries.'
        )


def run_viame(task, context, manager, conf, directory, arguments):
    command = f'. {shlex.quote(str(conf.viame_setup_script))} && '
    command += ' '.join(shlex.quote(str(arg)) for arg in arguments)
    manager.updateStatus(JobStatus.RUNNING)
    utils.stream_subprocess(
        task,
        context,
        manager,
        {
            'args': command,
            'shell': True,
            'executable': '/bin/bash',
            'cwd': directory,
            'env': conf.gpu_process_env,
        },
    )


def build_index(task, context, manager, conf, root, params):
    gc = task.girder_client
    dataset_id = params['datasetId']
    folder = gc.getFolder(dataset_id)
    media = utils.make_directory(root / 'media')
    # Match the media and timeline displayed by the web viewer.
    files, media_type = utils.download_source_media(gc, dataset_id, media, True)
    index = utils.make_directory(root / 'index')
    command = [
        'python',
        conf.viame_install_path / 'configs' / 'index.py',
        'add',
        '--backend',
        'files',
        '--database',
        index / 'database',
        '--yes',
        '--method',
        params['method'],
        '-install',
        conf.viame_install_path,
    ]
    if media_type == constants.VideoType:
        # Use a unique stream name even when users upload identically named videos.
        source = Path(files[0])
        renamed = source.with_name(dataset_id + source.suffix)
        source.rename(renamed)
        command += ['-v', renamed, '-frate', str(folder['meta'][constants.FPSMarker])]
    else:
        manifest = root / f'{dataset_id}.txt'
        manifest.write_text('\n'.join(files) + '\n')
        command += ['-l', manifest]
    if params['method'] == 'existing':
        annotations = root / 'detections.csv'
        utils.download_annotation_csv(gc, dataset_id, annotations)
        command += ['-id', annotations]
    run_viame(task, context, manager, conf, root, command)
    if not list((index / 'database').glob('*.index')):
        raise RuntimeError('No index was produced; see the job log.')
    return Path(shutil.make_archive(str(root / 'index'), 'zip', index))


def search(task, context, manager, conf, root, params):
    gc = task.girder_client
    indexes = []
    for position, index in enumerate(params['indexes']):
        archive = root / f'{position}.zip'
        gc.downloadFile(index['fileId'], str(archive))
        directory = utils.make_directory(root / f'index_{position}')
        extract_index(archive, directory)
        indexes.append(str(directory))
    exemplar = root / 'exemplar.png'
    gc.downloadFile(params['imageFileId'], str(exemplar))
    request = root / 'request.json'
    request.write_text(
        json.dumps(
            {
                'indexDirs': indexes,
                'datasetIds': [i['datasetId'] for i in params['indexes']],
                'imagePath': str(exemplar),
                'boxes': params['boxes'],
                'feedback': params['feedback'],
            }
        )
    )
    output = root / 'results.json'
    run_viame(
        task,
        context,
        manager,
        conf,
        root,
        [
            'python',
            Path(__file__).with_name('query_driver.py'),
            request,
            output,
        ],
    )
    if not output.is_file():
        raise RuntimeError('The query did not produce results; see the job log.')
    return output


@app.task(bind=True, acks_late=True, ignore_result=True)
def run_query(self, params):
    conf = Config()
    conf.require_viame_install()
    require_query_install(conf)
    manager = patch_manager(self.job_manager)
    context = {}
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return
    gc = self.girder_client
    utils.authenticate_urllib(gc)
    manager.updateStatus(JobStatus.FETCHING_INPUT)
    # Recheck source access when a queued job starts, using the submitter's token.
    gc.get(f"dive_query/{params['outputFolderId']}")
    with tempfile.TemporaryDirectory() as temporary, suppress(utils.CanceledError):
        root = Path(temporary)
        operation = build_index if params['operation'] == 'index' else search
        output = operation(self, context, manager, conf, root, params)
        if utils.check_canceled(self, context):
            manager.updateStatus(JobStatus.CANCELED)
            return
        gc.get(f"dive_query/{params['outputFolderId']}")
        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        gc.uploadFileToFolder(params['outputFolderId'], str(output))
