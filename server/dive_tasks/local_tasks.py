"""
Celery tasks bound to the ``local`` queue (same queue as Girder's ``importDataTask``).

Kept separate from ``tasks.py`` so the main worker task module stays focused on
GPU/default-queue work.
"""

from girder_worker.app import app


@app.task(queue='local', acks_late=True, ignore_result=True)
def run_batch_postprocess_job(job_id: str):
    """
    Run DIVE batch postprocess for an existing Girder job document.

    Scheduled on ``local`` so this runs in a normal Celery task instead of a
    daemon thread spawned from ``scheduleLocal``. A thread started when the
    import task is finishing is unreliable and often leaves the parent job
    stuck in INACTIVE.
    """
    from girder_jobs.models.job import Job

    from dive_tasks.dive_batch_postprocess import batch_postprocess_task

    job = Job().load(job_id, force=True)
    batch_postprocess_task(job)


@app.task(queue='local', acks_late=True, ignore_result=True)
def import_assetstore_path_async(
    assetstore_id: str,
    parent_id: str,
    parent_type: str,
    import_path: str,
    user_id: str,
    *,
    force_recursive: bool = False,
    leaf_folders_as_items: bool = False,
):
    """
    Run ``Assetstore.importData`` on the ``local`` queue (e.g. GCS bucket notifications).

    Keeps ``force_recursive=False`` for incremental object notifications; Girder's
    ``importDataTask`` does not forward that flag and defaults to full recursion.
    """
    from girder.models.assetstore import Assetstore
    from girder.models.user import User
    from girder.utility.model_importer import ModelImporter

    user = User().load(user_id, force=True)
    assetstore = Assetstore().load(assetstore_id)
    parent = ModelImporter.model(parent_type).load(parent_id, force=True)
    Assetstore().importData(
        assetstore,
        parent,
        parent_type,
        {'importPath': import_path},
        None,
        user,
        force_recursive=force_recursive,
        leafFoldersAsItems=leaf_folders_as_items,
    )
