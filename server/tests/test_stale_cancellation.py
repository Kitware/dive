from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from girder_jobs.constants import JobStatus
from girder_plugin_worker.status import CustomJobStatus

from dive_server import stale_cancellation
from dive_server.stale_cancellation import (
    STALE_CANCELING_TIMEOUT,
    reap_stale_canceling_jobs,
    stale_canceling_query,
)


def test_query_matches_only_stale_canceling_jobs():
    now = datetime.now(timezone.utc)
    query = stale_canceling_query(now)
    assert query['status'] == CustomJobStatus.CANCELING
    cutoff = query['updated']['$lt']
    assert cutoff == now - STALE_CANCELING_TIMEOUT
    # A job updated after the cutoff (still being acknowledged) is untouched
    assert not (now - timedelta(seconds=30)) < cutoff


def test_reap_moves_stale_jobs_to_canceled():
    job = {'_id': 'job1', 'status': CustomJobStatus.CANCELING,
           'updated': datetime.now(timezone.utc) - timedelta(days=2)}
    job_model = MagicMock()
    job_model.find.return_value = [job]

    reap_stale_canceling_jobs(job_model=job_model)

    job_model.updateJob.assert_called_once()
    _, kwargs = job_model.updateJob.call_args
    assert kwargs['status'] == JobStatus.CANCELED


def test_reap_rebroadcasts_revoke_for_queued_task(monkeypatch):
    revoked = []
    monkeypatch.setattr(stale_cancellation, 'rebroadcast_revoke', revoked.append)
    job = {'_id': 'job1', 'celeryTaskId': 'task-abc', 'status': CustomJobStatus.CANCELING,
           'updated': datetime.now(timezone.utc) - timedelta(days=2)}
    job_model = MagicMock()
    job_model.find.return_value = [job]

    reap_stale_canceling_jobs(job_model=job_model)

    assert revoked == ['task-abc']
    job_model.updateJob.assert_called_once()


def test_reap_continues_after_a_failing_job():
    good_job = {'_id': 'job2', 'status': CustomJobStatus.CANCELING,
                'updated': datetime.now(timezone.utc) - timedelta(days=2)}
    job_model = MagicMock()
    job_model.find.return_value = [{'_id': 'job1'}, good_job]
    calls = []

    def update_job(job, **kwargs):
        calls.append(job['_id'])
        if job['_id'] == 'job1':
            raise RuntimeError('validation failed')

    job_model.updateJob.side_effect = update_job

    reap_stale_canceling_jobs(job_model=job_model)

    assert calls == ['job1', 'job2']
