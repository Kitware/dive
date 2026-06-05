/* eslint-disable import/prefer-default-export -- single-purpose polling helper */
import girderRest from 'platform/web-girder/plugins/girder';
import { all } from '../girder-jobs/status';
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
  options?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    /** Called with average job completion fraction in [0, 1] when jobs report progress. */
    onProgress?: (fraction: number) => void;
  },
  jobIds: string[] = [],
): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? 1000;
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  /* eslint-disable no-await-in-loop -- poll folder and jobs until ready or timeout */
  while (Date.now() < deadline) {
    const { data: folder } = await getFolder(folderId);
    if (folder.meta?.annotate) {
      return;
    }

    if (jobIds.length) {
      const jobs = await Promise.all(
        jobIds.map(async (jobId) => {
          const { data: job } = await girderRest.get<{
            status: number;
            title?: string;
            progress?: { current: number; total: number };
          }>(`job/${jobId}`);
          return job;
        }),
      );
      if (options?.onProgress) {
        const jobsWithProgress = jobs.filter((job) => job.progress?.total);
        if (jobsWithProgress.length) {
          const fraction = jobsWithProgress.reduce(
            (sum, job) => sum + job.progress!.current / job.progress!.total,
            0,
          ) / jobsWithProgress.length;
          options.onProgress(fraction);
        }
      }
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
