"""Finalize jobs whose cancellation was never acknowledged by a worker.

Canceling a job moves it to CANCELING (824) and broadcasts a Celery revoke
(girder_plugin_worker.event_handlers.cancel). The job only reaches CANCELED
once a live worker acknowledges: either the running task notices the revoke
and stops, or Celery discards the revoked message when it is delivered. If no
worker is connected to the job's queue (a private standalone queue whose
worker is offline, or a worker that crashed or was redeployed), or a worker
restart wiped its in-memory revoked-task list, nothing ever acknowledges and
the job shows "Cancelling" indefinitely.

The Girder server periodically sweeps for jobs that have sat in CANCELING
with no update for STALE_CANCELING_TIMEOUT and moves them to CANCELED. The
revoke is also re-broadcast so a worker that reconnects later discards the
still-queued task message instead of running it.
"""

from datetime import datetime, timedelta, timezone
import logging

from celery.result import AsyncResult
from girder_jobs.constants import JobStatus
from girder_jobs.models.job import Job
from girder_plugin_worker.status import CustomJobStatus
from girder_worker.app import app

logger = logging.getLogger(__name__)

# A live worker acknowledges a cancel within about a minute (the subprocess
# monitor polls every 30 seconds), but a cancel that lands during a long
# non-polling phase (media download/upload) is only noticed when that phase
# ends. The timeout must outlast those phases; a job idle in CANCELING longer
# than this has no worker acting on it.
STALE_CANCELING_TIMEOUT = timedelta(minutes=30)
SWEEP_INTERVAL_SECONDS = 300


def stale_canceling_query(now: datetime) -> dict:
    return {
        'status': CustomJobStatus.CANCELING,
        'updated': {'$lt': now - STALE_CANCELING_TIMEOUT},
    }


def rebroadcast_revoke(celery_task_id: str):
    """Re-revoke so a worker that reconnects discards the queued task message."""
    AsyncResult(celery_task_id, app=app).revoke()


def reap_stale_canceling_jobs(job_model=None):
    # Never raise: cherrypy's Monitor permanently stops its background thread
    # on the first uncaught exception.
    try:
        _reap_stale_canceling_jobs(job_model)
    except Exception:
        logger.exception('Stale cancellation sweep failed')


def _reap_stale_canceling_jobs(job_model=None):
    job_model = job_model if job_model is not None else Job()
    now = datetime.now(timezone.utc)
    for job in job_model.find(stale_canceling_query(now)):
        try:
            logger.info(
                'Job %s stuck in CANCELING since %s; marking CANCELED',
                job['_id'],
                job.get('updated'),
            )
            celery_task_id = job.get('celeryTaskId')
            if celery_task_id:
                try:
                    rebroadcast_revoke(celery_task_id)
                except Exception:
                    logger.exception('Could not re-revoke Celery task %s', celery_task_id)
            job_model.updateJob(
                job,
                log='Cancellation was not acknowledged by any worker; '
                'the job has been marked as canceled.\n',
                status=JobStatus.CANCELED,
            )
        except Exception:
            logger.exception('Failed to finalize canceled job %s', job.get('_id'))
