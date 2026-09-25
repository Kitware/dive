import sys
import threading
import time
from pathlib import Path

import pytest

from dive_interactive.manager import BusyError, SessionManager
from dive_interactive.service import InteractiveProcess, ServiceError

FAKE = Path(__file__).parent / 'fixtures' / 'fake_interactive_service.py'


def spawn(_info):
    return InteractiveProcess([sys.executable, '-u', str(FAKE)], ready_timeout=10)


@pytest.fixture
def manager():
    manager = SessionManager(spawn, max_sessions=2, idle_seconds=60, queue_timeout=0.5, max_inflight=1)
    yield manager
    manager.stop_all()


def test_requests_are_answered_by_id_even_when_deferred(manager):
    first = manager.request('a', 'deferred', {})
    second = manager.request('a', 'predict', {'points': [[1, 2]]})
    assert first['deferred'] is True
    assert second['echo'] == {'points': [[1, 2]]}
    assert first['_session']['generation'] == second['_session']['generation']


def test_events_reusing_a_request_id_are_kept_for_polling(manager):
    manager.request('a', 'set_frame', {})
    time.sleep(0.3)
    events = manager.events('a', 0)
    assert [e.get('type') for e in events['events']] == ['disparity_ready']
    assert manager.events('a', events['next'])['events'] == []


def test_one_inference_at_a_time_and_a_refusal_instead_of_a_long_wait(manager):
    started = threading.Event()

    def slow():
        started.set()
        manager.request('a', 'sleep', {'seconds': 1.5})

    thread = threading.Thread(target=slow)
    thread.start()
    started.wait()
    time.sleep(0.1)
    with pytest.raises(BusyError):
        manager.request('b', 'predict', {})
    thread.join()
    assert manager.request('b', 'predict', {})['success'] is True


def test_session_cap_evicts_the_idlest_session(manager):
    manager.request('a', 'predict', {})
    manager.request('b', 'predict', {})
    a_generation = manager.request('a', 'predict', {})['_session']['generation']
    manager.request('c', 'predict', {})
    keys = {s['key'] for s in manager.status()['sessions']}
    assert keys == {'a', 'c'}
    assert manager.request('a', 'predict', {})['_session']['generation'] == a_generation


def test_idle_sessions_are_reaped_and_restarted_with_a_new_generation(manager):
    generation = manager.request('a', 'predict', {})['_session']['generation']
    assert manager.reap_idle(now=time.monotonic() + 120) == 1
    assert manager.status()['sessions'] == []
    assert manager.request('a', 'predict', {})['_session']['generation'] > generation


def test_a_crashed_session_is_reported_and_replaced(manager):
    with pytest.raises(ServiceError):
        manager.request('a', 'crash', {})
    assert manager.request('a', 'predict', {})['success'] is True
