"""Private query artifacts must not bypass dataset permissions."""

from unittest.mock import Mock

from girder.constants import AccessType
from girder.exceptions import AccessException, RestException
import pytest

from dive_server import views_query


def test_artifact_requires_creator_even_if_folder_was_shared(monkeypatch):
    folder = {
        '_id': 'artifact',
        'creatorId': 'someone-else',
        'meta': {'diveQuery': {'datasetIds': ['source']}},
    }
    model = Mock()
    model.load.return_value = folder
    monkeypatch.setattr(views_query, 'Folder', lambda: model)
    with pytest.raises(AccessException):
        views_query.load_artifact('artifact', {'_id': 'me'})
    model.load.assert_called_once_with(
        'artifact', user={'_id': 'me'}, level=AccessType.READ, exc=True
    )


def test_artifact_rechecks_every_source_permission(monkeypatch):
    folder = {
        '_id': 'artifact',
        'creatorId': 'me',
        'meta': {'diveQuery': {'datasetIds': ['allowed', 'revoked']}},
    }
    model = Mock()
    model.load.return_value = folder
    monkeypatch.setattr(views_query, 'Folder', lambda: model)
    load = Mock(side_effect=[{}, AccessException('revoked')])
    monkeypatch.setattr(views_query, 'load_dataset', load)
    with pytest.raises(AccessException):
        views_query.load_artifact('artifact', {'_id': 'me'})
    assert [call.args[0] for call in load.call_args_list] == ['allowed', 'revoked']


def test_query_only_accepts_supported_dataset_media(monkeypatch):
    model = Mock()
    model.load.return_value = {'meta': {'annotate': True, 'type': 'multi'}}
    monkeypatch.setattr(views_query, 'Folder', lambda: model)
    with pytest.raises(RestException, match='individual camera'):
        views_query.load_dataset('dataset', {'_id': 'me'})


def test_index_submission_uses_private_artifact_and_pipeline_queue(monkeypatch):
    import inspect

    user = {'_id': 'me'}
    dataset = {'_id': 'dataset', 'name': 'My video', 'meta': {'annotate': True, 'type': 'video'}}
    output = {'_id': 'output'}
    model = Mock()
    model.load.return_value = dataset
    model.createFolder.return_value = output
    monkeypatch.setattr(views_query, 'Folder', lambda: model)
    monkeypatch.setattr(views_query.worker_capabilities, 'require_pipeline_worker', Mock())
    token_model = Mock()
    token_model.createToken.return_value = {'_id': 'token'}
    monkeypatch.setattr(views_query, 'Token', lambda: token_model)
    queue = Mock(return_value='pipelines')
    monkeypatch.setattr(views_query.crud_rpc, '_get_queue_name', queue)
    persist = Mock(return_value={'_id': 'job'})
    monkeypatch.setattr(views_query.crud_rpc, '_persist_async_job_metadata', persist)
    dispatch = Mock()
    monkeypatch.setattr(views_query.run_query, 'apply_async', dispatch)
    resource = Mock()
    resource.getCurrentUser.return_value = user

    result = inspect.unwrap(views_query.QueryResource.submit)(
        resource, {'operation': 'index', 'datasetId': 'dataset', 'method': 'frames'}
    )

    assert result['jobId'] == 'job'
    assert model.createFolder.call_args.kwargs['public'] is False
    assert model.createFolder.call_args.kwargs['creator'] == user
    queue.assert_called_once_with(user, 'pipelines')
    assert dispatch.call_args.kwargs['queue'] == 'pipelines'
    task_args = dispatch.call_args.kwargs['kwargs']
    assert task_args['girder_client_token'] == 'token'
    assert task_args['params']['outputFolderId'] == 'output'
    assert task_args['params']['datasetIds'] == ['dataset']
    # Query work does not lock or inherit sharing from the source dataset.
    assert persist.call_args.kwargs['access_source'] == output


def test_old_postgres_worker_is_rejected_before_query_execution(tmp_path):
    from types import SimpleNamespace

    from dive_tasks.run_query import require_query_install

    configs = tmp_path / 'configs'
    pipelines = configs / 'pipelines'
    pipelines.mkdir(parents=True)
    (configs / 'index.py').touch()
    for name in ('query_retrieval_and_iqr.pipe', 'query_image_exemplar.pipe'):
        (pipelines / name).touch()
    inner = pipelines / 'query_and_iqr.pipe'
    inner.write_text(':conn_str postgresql:host=localhost')
    conf = SimpleNamespace(viame_install_path=tmp_path)
    with pytest.raises(RuntimeError, match='file-backed'):
        require_query_install(conf)
    inner.write_text(':descriptor_index_dir database\n#:conn_str postgresql:host=localhost')
    require_query_install(conf)


def test_query_subprocess_inherits_worker_gpu_assignment_and_is_streamed(monkeypatch, tmp_path):
    import shlex
    from types import SimpleNamespace

    from dive_tasks import run_query

    task = Mock()
    manager = Mock()
    context = {}
    conf = SimpleNamespace(
        viame_setup_script=tmp_path / 'setup with spaces.sh',
        gpu_process_env={'CUDA_VISIBLE_DEVICES': '2'},
    )
    stream = Mock()
    monkeypatch.setattr(run_query.utils, 'stream_subprocess', stream)
    argument = str(tmp_path / 'image $(touch wrong).png')
    run_query.run_viame(task, context, manager, conf, tmp_path, ['python', argument])
    popen = stream.call_args.args[3]
    assert popen['env'] == {'CUDA_VISIBLE_DEVICES': '2'}
    assert popen['cwd'] == tmp_path
    assert shlex.split(popen['args'].split(' && ', 1)[1]) == ['python', argument]
    assert stream.call_args.args[:3] == (task, context, manager)
