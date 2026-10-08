"""Background job that computes a global annotation inventory report for admins."""

from girder.models.user import User
from girder_jobs.models.job import Job, JobStatus
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager

from dive_server.crud_annotation_stats import compute_annotation_stats, save_annotation_stats_report
from dive_tasks.manager import patch_manager

# Approximate stage count for the Girder progress bar (logs still list every step).
PROGRESS_TOTAL = 9


def _girder_job_id(manager: JobManager, task: Task):
    """Resolve the Girder job id for this Celery task."""
    # jobInfoSpec sets JobManager.reference to str(job['_id']).
    ref = getattr(manager, 'reference', None)
    if ref:
        return ref
    # Fallback: jobs scheduled by girder-worker store celeryTaskId.
    task_id = getattr(getattr(task, 'request', None), 'id', None)
    if task_id:
        found = Job().findOne({'celeryTaskId': task_id})
        if found:
            return found['_id']
    return None


@app.task(bind=True, queue='local', acks_late=True, ignore_result=True)
def run_annotation_stats_job(self: Task) -> None:
    """
    Build the annotation inventory report, store it on ``job.meta.annotationStats``,
    and save JSON under the running admin user's ``Stats`` folder.

    Scheduled with ``girder_job_title`` so Girder shows one named job (same pattern
    as finalize_multicam — not createLocalJob + .delay()).
    """
    manager = patch_manager(self.job_manager)
    manager.updateStatus(JobStatus.RUNNING)
    manager.updateProgress(total=PROGRESS_TOTAL, current=0, message='Starting')
    manager.write('Started annotation stats report\n')

    step = {'n': 0}

    def on_progress(message: str) -> None:
        step['n'] += 1
        manager.updateProgress(
            total=PROGRESS_TOTAL,
            current=min(step['n'], PROGRESS_TOTAL - 1),
            message=message,
        )
        manager.write(f'{message}\n')

    try:
        report = compute_annotation_stats(progress=on_progress)
        job_id = _girder_job_id(manager, self)
        if not job_id:
            raise RuntimeError('Annotation stats job is missing its Girder job id')
        job = Job().load(job_id, force=True)
        user = User().load(job['userId'], force=True)
        if not user:
            raise RuntimeError('Annotation stats job is missing its owning user')

        on_progress(f'Saving report to user Stats folder for {user.get("login", user["_id"])}...')
        saved = save_annotation_stats_report(user, report)
        manager.write(
            f'Saved {saved["latestFileName"]} under ~/{saved["folderName"]} '
            f'(folderId={saved["folderId"]})\n'
        )

        meta = dict(job.get('meta') or {})
        meta['annotationStats'] = report
        meta['annotationStatsSaved'] = saved
        summary = (
            'Finished annotation stats report: '
            f"{report['datasets']['total']} datasets, "
            f"{report['tracks']['total']} tracks, "
            f"{report['tracks']['confidenceGte1']} confidence>=1, "
            f"{len(report['labels'])} labels\n"
        )
        manager.updateProgress(
            total=PROGRESS_TOTAL,
            current=PROGRESS_TOTAL,
            message='Complete',
            forceFlush=True,
        )
        Job().updateJob(
            job,
            log=summary,
            status=JobStatus.SUCCESS,
            otherFields={'meta': meta},
        )
    except Exception as exc:
        manager.write(f'Annotation stats report failed: {exc}\n')
        manager.updateStatus(JobStatus.ERROR)
        raise
