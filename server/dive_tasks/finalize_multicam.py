"""Wait for per-camera postprocess jobs, then link a multicam parent dataset."""

import time
from typing import Any, Dict, List, Optional

from girder.models.folder import Folder
from girder.models.user import User
from girder_jobs.models.job import Job, JobStatus
from girder_worker.app import app
from girder_worker.task import Task

from dive_server import crud_dataset
from dive_tasks.manager import patch_manager
from dive_utils import constants, fromMeta

POLL_INTERVAL_SEC = 2.0
DEFAULT_TIMEOUT_SEC = 60 * 60  # 1 hour


def _terminal(status: int) -> bool:
    return status in {JobStatus.SUCCESS, JobStatus.ERROR, JobStatus.CANCELED}


def _folder_ready(folder_id: str) -> bool:
    folder = Folder().load(folder_id, force=True)
    return bool(folder and fromMeta(folder, constants.DatasetMarker))


@app.task(bind=True, queue='local', acks_late=True, ignore_result=True)
def finalize_multicam(self: Task, params: Dict[str, Any]) -> None:
    """
    After multicam camera uploads: wait until each camera folder is a DIVE
    dataset (postprocess / transcode / stitched split finished), then call
    create_multicam and optionally seed registration metadata.

    Scheduled with ``girder_job_title`` so Girder shows a named convert job
    (same pattern as video/image convert — not createLocalJob + .delay()).
    """
    manager = patch_manager(self.job_manager)
    parent_folder_id = params['parent_folder_id']
    create_args: Dict[str, Any] = params['create_args']
    wait_job_ids: List[str] = list(params.get('wait_job_ids') or [])
    registration: Optional[Dict[str, Any]] = params.get('registration')
    timeout_sec = float(params.get('timeout_sec') or DEFAULT_TIMEOUT_SEC)
    user = User().load(params['user_id'], force=True)

    manager.updateStatus(JobStatus.RUNNING)
    manager.write('Started multicam finalize\n')

    camera_folder_ids = [
        str(cam['folderId'])
        for cam in create_args.get('cameras', {}).values()
        if cam.get('folderId')
    ]
    deadline = time.time() + timeout_sec

    try:
        while time.time() < deadline:
            # Honor cancel of this finalize job (JobManager keeps the Girder job doc).
            own = getattr(manager, '_job', None) or {}
            own_id = own.get('_id')
            if own_id:
                own_job = Job().load(own_id, force=True)
                if not own_job or own_job['status'] in {JobStatus.CANCELED, JobStatus.ERROR}:
                    return

            if wait_job_ids:
                jobs = [Job().load(jid, force=True) for jid in wait_job_ids]
                missing = [jid for jid, job in zip(wait_job_ids, jobs) if job is None]
                if missing:
                    raise RuntimeError(f'Postprocess job(s) missing: {", ".join(missing)}')
                failed = [
                    job for job in jobs if job['status'] in {JobStatus.ERROR, JobStatus.CANCELED}
                ]
                if failed:
                    titles = ', '.join(job.get('title') or str(job['_id']) for job in failed)
                    raise RuntimeError(f'Camera postprocess failed: {titles}')
                if not all(_terminal(job['status']) for job in jobs):
                    manager.write('Waiting for camera postprocess jobs…\n')
                    time.sleep(POLL_INTERVAL_SEC)
                    continue

            if all(_folder_ready(fid) for fid in camera_folder_ids):
                break

            manager.write('Waiting for camera folders to become datasets…\n')
            time.sleep(POLL_INTERVAL_SEC)
        else:
            raise RuntimeError('Timed out waiting for camera folder processing')

        parent = Folder().load(parent_folder_id, force=True)
        if parent is None:
            raise RuntimeError(f'Parent folder {parent_folder_id} was not found')

        manager.write('Linking multicam cameras…\n')
        result = crud_dataset.create_multicam(user, parent, create_args)
        warnings = result.get('importWarnings') if isinstance(result, dict) else None
        if warnings:
            manager.write(
                'Import warnings:\n' + '\n'.join(f'- {w}' for w in warnings) + '\n',
            )

        if registration:
            manager.write('Saving camera registration…\n')
            linked = Folder().load(parent_folder_id, force=True)
            if linked is None:
                raise RuntimeError(f'Parent folder {parent_folder_id} was not found after link')
            crud_dataset.update_metadata(linked, registration, verify=True)

        manager.write('Finished multicam finalize\n')
        manager.updateStatus(JobStatus.SUCCESS)
    except Exception as exc:
        manager.write(f'Error during multicam finalize: {exc}\n')
        manager.updateStatus(JobStatus.ERROR)
        raise
