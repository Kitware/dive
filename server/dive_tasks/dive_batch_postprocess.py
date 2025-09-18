import threading
import time
from typing import List

from girder.models.token import Token
from girder.models.user import User
from girder_client import GirderClient
from girder_jobs.models.job import Job
from girder_worker.task import Task
from girder_worker.utils import JobStatus


class DIVEBatchPostprocessTaskParams:
    """Describes the parameters for running batch postprocess on folders with MarkForPostProcess flag"""

    def __init__(
        self,
        source_folder_id: str,
        skipJobs: bool,
        skipTranscoding: bool,
        additive: bool,
        additivePrepend: str,
        userId: str,
        girderToken: str,
        girderApiUrl: str,
    ):
        self.source_folder_id = source_folder_id
        self.skipJobs = skipJobs
        self.skipTranscoding = skipTranscoding
        self.additive = additive
        self.additivePrepend = additivePrepend
        self.userId = userId
        self.girderToken = girderToken
        self.girderApiUrl = girderApiUrl


def batch_postprocess_task(baseJob: Task):
    """
    Run batch postprocess on folders with MarkForPostProcess flag.

    :param baseJob: the job model containing the task parameters.
    """
    params = baseJob['kwargs']['params']

    source_folder_id = params['source_folder_id']
    skipJobs = params['skipJobs']
    skipTranscoding = params['skipTranscoding']
    additive = params['additive']
    additivePrepend = params['additivePrepend']
    userId = params['userId']
    user = User().load(userId, force=True)
    token = Token().createToken(user=user)

    # Initialize Girder client
    gc = GirderClient(apiUrl=params['girderApiUrl'])
    gc.token = token['_id']

    # Update base job status
    baseJob = Job().updateJob(
        baseJob,
        log='Started DIVE Batch Postprocess processing\n',
        status=JobStatus.RUNNING,
    )

    # Find all folders with MarkForPostProcess flag
    marked_folders = []
    _find_marked_folders(gc, source_folder_id, marked_folders)

    total_count = len(marked_folders)
    if total_count == 0:
        Job().updateJob(
            baseJob,
            log='No folders found with MarkForPostProcess flag\n',
            status=JobStatus.SUCCESS,
        )
        return

    Job().updateJob(
        baseJob,
        log=f'Found {total_count} folders marked for postprocess\n',
        progressTotal=total_count,
        status=JobStatus.RUNNING,
    )

    # Process folders one by one
    processed = 0
    done = False
    current_job_id = None

    try:
        while not done:
            baseJob = Job().load(id=baseJob['_id'], force=True)

            if not baseJob or baseJob['status'] in {
                JobStatus.CANCELED,
                JobStatus.ERROR,
            }:
                break

            # Check if we have a current job running
            if current_job_id:
                try:
                    current_job = Job().load(current_job_id, force=True)
                    if current_job and current_job['status'] in {
                        JobStatus.SUCCESS,
                        JobStatus.ERROR,
                        JobStatus.CANCELED,
                        JobStatus.INACTIVE,
                    }:
                        # Current job finished, move to next
                        current_job_id = None
                        processed += 1

                        if current_job['status'] == JobStatus.SUCCESS:
                            Job().updateJob(
                                baseJob,
                                log=f'Completed postprocess for folder {processed} of {total_count}\n',
                                progressCurrent=processed,
                                progressTotal=total_count,
                                status=JobStatus.RUNNING,
                            )
                        else:
                            error_msg = current_job.get("log", "Unknown error")
                            Job().updateJob(
                                baseJob,
                                log=f'Postprocess failed for folder {processed} of {total_count}: {error_msg}\n',
                                progressCurrent=processed,
                                progressTotal=total_count,
                                status=JobStatus.RUNNING,
                            )
                    if current_job and current_job['status'] in {JobStatus.INACTIVE}:
                        # If the job errored or was canceled, we should move on
                        Job().cancelJob(current_job)
                        Job().updateJob(
                            baseJob,
                            log='Job became inactive but finished moving on to next job, previous error can be ignored\n',
                            progressCurrent=processed,
                            progressTotal=total_count,
                            status=JobStatus.RUNNING,
                        )
                        current_job_id = None
                        processed += 1
                except Exception as e:
                    # Job might have been deleted or other error, continue
                    Job().cancelJob(current_job)
                    current_job_id = None
                    processed += 1
                    Job().updateJob(
                        baseJob,
                        log=f'Lost track of job for folder {processed} of {total_count}, continuing...\n Error: {str(e)}\n',
                        progressCurrent=processed,
                        progressTotal=total_count,
                        status=JobStatus.RUNNING,
                    )

            # Start next job if we don't have one running and have more to process
            if not current_job_id and processed < total_count:
                folder_id = marked_folders[processed]
                folder_name = _get_folder_name(gc, folder_id)

                try:
                    # Call postprocess endpoint for this folder
                    result = gc.post(
                        f'dive_rpc/postprocess/{folder_id}',
                        data={
                            'skipJobs': skipJobs,
                            'skipTranscoding': skipTranscoding,
                            'additive': additive,
                            'additivePrepend': additivePrepend,
                        },
                    )

                    # If skipJobs=True, postprocess runs synchronously
                    if skipJobs:
                        Job().updateJob(
                            baseJob,
                            log=f'Completed postprocess for folder {processed + 1} of {total_count}: {folder_name}\n',
                            progressCurrent=processed + 1,
                            progressTotal=total_count,
                            status=JobStatus.RUNNING,
                        )
                        processed += 1
                    else:
                        # For async jobs, track the created job IDs
                        job_ids = result.get('job_ids', [])
                        if job_ids:
                            # Track the first job ID (usually the main processing job)
                            current_job_id = job_ids[0]
                            Job().updateJob(
                                baseJob,
                                log=f'Started postprocess for folder {processed + 1} of {total_count}: {folder_name} (tracking job {current_job_id})\n',
                                progressCurrent=processed,
                                progressTotal=total_count,
                                status=JobStatus.RUNNING,
                            )
                        else:
                            # No jobs created, treat as synchronous
                            Job().updateJob(
                                baseJob,
                                log=f'Completed postprocess for folder {processed + 1} of {total_count}: {folder_name} (no jobs created)\n',
                                progressCurrent=processed + 1,
                                progressTotal=total_count,
                                status=JobStatus.RUNNING,
                            )
                            processed += 1

                except Exception as e:
                    Job().updateJob(
                        baseJob,
                        log=f'Error processing folder {folder_name}: {str(e)}\n',
                        progressCurrent=processed + 1,
                        progressTotal=total_count,
                        status=JobStatus.RUNNING,
                    )
                    processed += 1  # Continue with next folder
                    continue

            # Check if we're done
            if processed >= total_count:
                done = True
                break

            time.sleep(0.1)

    except Exception as exc:
        Job().updateJob(
            baseJob,
            log=f'Error During DIVE Batch Postprocess: {str(exc)}\n',
            status=JobStatus.ERROR,
        )

    Job().updateJob(
        baseJob,
        log=f'Finished DIVE Batch Postprocess: {processed}/{total_count} folders processed\n',
        status=JobStatus.SUCCESS,
    )


def batchPostProcessingTaskLauncher(job):
    """
    Run a batch of jobs via a thread.

    :param job: the job model.
    """
    proc = threading.Thread(target=batch_postprocess_task, args=(job,), daemon=True)
    proc.start()
    return job, proc


def _find_marked_folders(gc: GirderClient, folder_id: str, marked_folders: List[str]):
    """
    Recursively find all child folders with MarkForPostProcess flag.

    :param gc: GirderClient instance
    :param folder_id: ID of the folder to search
    :param marked_folders: List to append marked folder IDs to
    """
    try:
        # Get child folders
        child_folders = gc.listFolder(folder_id, 'folder')

        for child_folder in child_folders:
            # Check if this folder has MarkForPostProcess flag
            if child_folder.get('meta', {}).get('MarkForPostProcess', False):
                marked_folders.append(child_folder['_id'])

            # Recursively search child folders
            _find_marked_folders(gc, child_folder['_id'], marked_folders)

    except Exception as e:
        # Log error but continue processing
        print(f"Error searching folder {folder_id}: {str(e)}")


def _get_folder_name(gc: GirderClient, folder_id: str) -> str:
    """
    Get the name of a folder by its ID.

    :param gc: GirderClient instance
    :param folder_id: ID of the folder
    :return: Folder name or folder_id if name cannot be retrieved
    """
    try:
        folder = gc.getFolder(folder_id)
        return folder.get('name', folder_id)
    except Exception:
        return folder_id