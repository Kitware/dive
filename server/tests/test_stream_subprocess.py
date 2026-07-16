import signal
from unittest.mock import MagicMock

import pytest

from dive_tasks.utils import describe_exit, stream_subprocess


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
