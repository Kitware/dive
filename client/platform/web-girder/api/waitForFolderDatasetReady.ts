import { all } from '@girder/components/src/components/Job/status';
import girderRest from 'platform/web-girder/plugins/girder';
import { getFolder } from './girder.service';

const JobStatus = all();
const TERMINAL_JOB_STATUSES = [
  JobStatus.SUCCESS.value,
  JobStatus.ERROR.value,
  JobStatus.CANCELED.value,
];

/**
 * Wait until a folder has been marked as a DIVE dataset (post-process / transcode finished).
 * Used by multicam import so child camera folders are valid before create_multicam runs.
 */
export async function waitForFolderDatasetReady(
  folderId: string,
  jobIds: string[] = [],
  options?: { pollIntervalMs?: number; timeoutMs?: number },
): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? 1000;
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data: folder } = await getFolder(folderId);
    if (folder.meta?.annotate) {
      return;
    }

    if (jobIds.length) {
      const jobs = await Promise.all(
        jobIds.map(async (jobId) => {
          const { data: job } = await girderRest.get<{ status: number; title?: string }>(`job/${jobId}`);
          return job;
        }),
      );
      const allTerminal = jobs.every((job) => TERMINAL_JOB_STATUSES.includes(job.status));
      if (allTerminal) {
        const failed = jobs.filter((job) => job.status !== JobStatus.SUCCESS.value);
        if (failed.length) {
          const detail = failed.map((job) => job.title || 'processing job failed').join('; ');
          throw new Error(detail);
        }
        const { data: folderAfterJobs } = await getFolder(folderId);
        if (folderAfterJobs.meta?.annotate) {
          return;
        }
        throw new Error('Video processing finished but the camera folder is not ready for import');
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }

  throw new Error('Timed out waiting for camera video processing');
}
