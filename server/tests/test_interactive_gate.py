from unittest.mock import MagicMock, patch

from girder.exceptions import RestException
import pytest

from dive_server import interactive_gate


@pytest.fixture(autouse=True)
def reset_cache():
    interactive_gate._health_cache.update(at=0.0, value=None)
    yield
    interactive_gate._health_cache.update(at=0.0, value=None)


def test_disabled_without_a_broker(monkeypatch):
    monkeypatch.delenv('DIVE_INTERACTIVE_URL', raising=False)
    capability = interactive_gate.get_interactive_capability()
    assert capability['interactiveEnabled'] is False
    with pytest.raises(RestException) as err:
        interactive_gate.require_interactive_available()
    assert err.value.code == 503


@patch('dive_server.interactive_gate.Job')
@patch('dive_server.interactive_gate.requests.get')
def test_paused_while_gpu_jobs_run(get, job_cls, monkeypatch):
    monkeypatch.setenv('DIVE_INTERACTIVE_URL', 'http://interactive:8800/')
    get.return_value = MagicMock(json=lambda: {'ok': True, 'stereoMethods': ['ncc']})
    job_cls.return_value.findOne.return_value = {'_id': 'running'}
    capability = interactive_gate.get_interactive_capability()
    assert capability['interactiveEnabled'] is False
    assert capability['interactiveMessage'] == interactive_gate.BUSY_MESSAGE
    with pytest.raises(RestException) as err:
        interactive_gate.require_interactive_available()
    assert err.value.code == 503
    query = job_cls.return_value.findOne.call_args[0][0]
    assert set(query['type']['$in']) == {'pipelines', 'training', 'private'}


@patch('dive_server.interactive_gate.Job')
@patch('dive_server.interactive_gate.requests.get')
def test_enabled_when_the_broker_answers_and_the_gpu_is_free(get, job_cls, monkeypatch):
    monkeypatch.setenv('DIVE_INTERACTIVE_URL', 'http://interactive:8800')
    get.return_value = MagicMock(json=lambda: {'ok': True, 'stereoMethods': ['ncc', 'foundation'], 'textQuery': True})
    job_cls.return_value.findOne.return_value = None
    capability = interactive_gate.get_interactive_capability()
    assert capability == {
        'interactiveEnabled': True,
        'interactiveMessage': '',
        'interactiveStereoMethods': ['ncc', 'foundation'],
        'interactiveTextQuery': True,
    }
    assert interactive_gate.require_interactive_available() == 'http://interactive:8800'
    # The health probe is cached, not repeated per call.
    interactive_gate.get_interactive_capability()
    assert get.call_count == 1
