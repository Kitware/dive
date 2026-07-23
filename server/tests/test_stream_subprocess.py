import signal
import time
from unittest.mock import MagicMock

import pytest
from girder_worker.utils import JobStatus

from dive_tasks import utils
from dive_tasks.utils import CanceledError, describe_exit, stream_subprocess


def run_command(args):
    task = MagicMock()
    task.canceled = False
    manager = MagicMock()
    manager.status = None
    return stream_subprocess(task, {}, manager, {'args': args})


def test_describe_exit_names_the_signal():
    described = describe_exit(-signal.SIGKILL)
    assert 'SIGKILL' in described
    assert '9' in described


def test_describe_exit_reports_the_status_code():
    assert 'status code 3' in describe_exit(3)


def test_signal_killed_subprocess_raises():
    """
    A pipeline killed by a signal must not be reported as successful.

    Popen surfaces a kill as a negative return code, so an OOM-killed pipeline
    exits -9.  Callers upload and ingest the pipeline's output file on success,
    so treating this as success overwrites annotations with a partial result.
    """
    with pytest.raises(RuntimeError, match='SIGKILL'):
        run_command(['bash', '-c', 'kill -9 $$'])


def test_nonzero_exit_raises():
    with pytest.raises(RuntimeError, match='status code 3'):
        run_command(['bash', '-c', 'exit 3'])


def test_successful_exit_returns_normally():
    assert run_command(['bash', '-c', 'exit 0']) == ""


def test_cancel_kills_process_group_and_raises_canceled(monkeypatch):
    """
    Cancel must kill shell descendants, not only the shell PID.

    Long VIAME jobs use shell=True. If only the shell is signaled, children
    keep stdout open and stream_subprocess blocks forever in CANCELING.
    """
    monkeypatch.setattr(utils, 'CANCEL_MONITOR_INTERVAL', 0.05)
    monkeypatch.setattr(utils, 'CANCEL_TERM_GRACE_SECONDS', 0.5)

    # Background child keeps writing; shell waits on it. Without process-group
    # kill this hangs on readline after the shell alone is killed.
    script = r"""
python3 -c "
import sys, time
while True:
    print('tick', flush=True)
    time.sleep(0.05)
" &
wait
"""
    task = MagicMock()
    task.canceled = False
    manager = MagicMock()
    manager.status = None

    def flip_cancel(*_args, **_kwargs):
        task.canceled = True
        manager.status = JobStatus.CANCELING

    # First status refresh arms cancel so the monitor notices quickly.
    manager.refreshStatus.side_effect = flip_cancel

    start = time.monotonic()
    with pytest.raises(CanceledError, match='canceled'):
        stream_subprocess(
            task,
            {},
            manager,
            {
                'args': script,
                'shell': True,
                'executable': '/bin/bash',
            },
        )
    elapsed = time.monotonic() - start

    manager.updateStatus.assert_called_with(JobStatus.CANCELED)
    # Must finish promptly; a hang here is the production failure mode.
    assert elapsed < 10


def test_cancel_via_task_canceled_flag(monkeypatch):
    monkeypatch.setattr(utils, 'CANCEL_MONITOR_INTERVAL', 0.05)
    monkeypatch.setattr(utils, 'CANCEL_TERM_GRACE_SECONDS', 0.5)

    task = MagicMock()
    task.canceled = False
    manager = MagicMock()
    manager.status = None

    def flip_cancel(*_args, **_kwargs):
        task.canceled = True

    manager.refreshStatus.side_effect = flip_cancel

    with pytest.raises(CanceledError, match='canceled'):
        stream_subprocess(
            task,
            {},
            manager,
            {
                'args': 'while true; do echo tick; sleep 0.05; done',
                'shell': True,
                'executable': '/bin/bash',
            },
        )

    manager.updateStatus.assert_called_with(JobStatus.CANCELED)
