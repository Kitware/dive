"""
Register Girder model events on the Celery worker.

Assetstore imports run in ``importDataTask`` and ``import_assetstore_path_async`` (queue
``local``). Those processes do not load Girder server plugins, so per-file and post-import
handlers are registered here instead of in ``dive_server``.

``run_post_assetstore_import`` schedules local Girder jobs (e.g. batch postprocess). Those
jobs only leave ``INACTIVE`` when ``jobs.schedule`` is handled; the Jobs plugin registers
that on the web server, so we bind the same handler here.
"""

from girder import events
from girder_jobs import scheduleLocal

from dive_server.event import (
    process_fs_import,
    process_s3_import,
    run_post_assetstore_import,
)


def _register():
    events.bind(
        's3_assetstore_imported',
        'dive_worker_s3_assetstore_imported',
        process_s3_import,
    )
    events.bind(
        'filesystem_assetstore_imported',
        'dive_worker_filesystem_assetstore_imported',
        process_fs_import,
    )
    events.bind(
        'assetstore_import.after',
        'dive_worker_assetstore_import_after',
        run_post_assetstore_import,
    )
    events.bind(
        'jobs.schedule',
        'dive_worker_jobs_schedule_local',
        scheduleLocal,
    )


_register()
