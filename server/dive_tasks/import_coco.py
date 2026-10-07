"""Import COCO annotations that include RLE masks as a convert-style job."""

from contextlib import suppress

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.manager import patch_manager


@app.task(bind=True, acks_late=True, ignore_result=True)
def import_coco_annotations(
    self: Task,
    folderId: str,
    user_id: str,
    user_login: str,
    additive: bool = False,
    additivePrepend: str = '',
    set: str = '',
):
    """Finish COCO import for files whose RLE masks were deferred from postprocess.

    Postprocess only enqueues this job when RLE COCO is the sole annotation source
    in the batch (mixed CSV/JSON/KPF stays on the sync path to preserve overwrite
    ordering). The job is started after the originating ``process_items`` sweep so
    hierarchy/fps staging is already applied before this worker re-enters
    ``dive_rpc/postprocess`` with ``skipJobs=True``.
    """
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    with suppress(utils.CanceledError):
        manager.updateStatus(JobStatus.RUNNING)
        manager.write(f'Importing COCO annotations with RLE masks for folder {folderId}...\n')
        data = {
            'skipJobs': True,
            'additive': additive,
            'additivePrepend': additivePrepend,
        }
        if set:
            data['set'] = set
        result = gc.post(f'dive_rpc/postprocess/{folderId}', data=data)
        warnings = (result or {}).get('warnings') or []
        for warning in warnings:
            manager.write(f'Warning: {warning}\n')
        manager.write('Finished COCO RLE annotation import.\n')
