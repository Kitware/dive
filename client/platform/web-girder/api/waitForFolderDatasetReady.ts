/* eslint-disable import/prefer-default-export -- single-purpose polling helper */
import { all } from '@girder/components/src/components/Job/status';
import girderRest from 'platform/web-girder/plugins/girder';
import { getFolder, getItemsInFolder } from './girder.service';

const JobStatus = all();
const TERMINAL_JOB_STATUSES = [
  JobStatus.SUCCESS.value,
  JobStatus.ERROR.value,
  JobStatus.CANCELED.value,
];

const LARGE_IMAGE_ITEM_PATTERN = /\.(tif|tiff|nitf|ntf|vrt)$/i;
const VIEWABLE_IMAGE_PATTERN = /\.(png|jpe?g)$/i;

async function countLargeImageItems(folderId: string): Promise<number> {
  let offset = 0;
  const limit = 100;
  let count = 0;
  let hasMore = true;
  /* eslint-disable no-await-in-loop -- paginate folder items until all are checked */
  while (hasMore) {
    const { data: items } = await getItemsInFolder(folderId, limit, offset);
    if (!items.length) {
      break;
    }
    count += items.filter((item) => LARGE_IMAGE_ITEM_PATTERN.test(item.name)).length;
    hasMore = items.length >= limit;
    if (hasMore) {
      offset += items.length;
    }
  }
  return count;
}

async function countViewableImages(folderId: string): Promise<number> {
  let offset = 0;
  const limit = 100;
  let count = 0;
  let hasMore = true;
  /* eslint-disable no-await-in-loop -- paginate folder items until all are checked */
  while (hasMore) {
    const { data: items } = await getItemsInFolder(folderId, limit, offset);
    if (!items.length) {
      break;
    }
    count += items.filter((item) => VIEWABLE_IMAGE_PATTERN.test(item.name)).length;
    hasMore = items.length >= limit;
    if (hasMore) {
      offset += items.length;
    }
  }
  return count;
}

/**
 * Wait until a folder has been marked as a DIVE dataset (post-process / transcode finished).
 * Used by multicam import so child camera folders are valid before create_multicam runs.
 */
export async function waitForFolderDatasetReady(
  folderId: string,
  options?: {
    pollIntervalMs?: number;
    /**
     * Give up after this long without progress. A job reporting new progress
     * restarts the clock, so a long job that keeps moving is not cut off.
     */
    timeoutMs?: number;
    /**
     * Called when jobs report progress, with the average completion fraction
     * in [0, 1] and the summed item counts across those jobs.
     */
    onProgress?: (fraction: number, counts: { current: number; total: number }) => void;
    /** When true, keep polling until at least one web-safe image exists in the folder. */
    requireViewableImages?: boolean;
    /** When true, keep polling until at least one tiled/large-image file exists in the folder. */
    requireLargeImageItems?: boolean;
  },
  jobIds: string[] = [],
): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? 1000;
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
  let deadline = Date.now() + timeoutMs;
  let lastProgress = '';

  async function folderReady(): Promise<boolean> {
    const { data: folder } = await getFolder(folderId);
    if (!folder.meta?.annotate) {
      return false;
    }
    if (options?.requireViewableImages) {
      const viewableCount = await countViewableImages(folderId);
      return viewableCount > 0;
    }
    if (options?.requireLargeImageItems) {
      const largeImageCount = await countLargeImageItems(folderId);
      return largeImageCount > 0;
    }
    return true;
  }

  /* eslint-disable no-await-in-loop -- poll folder and jobs until ready or timeout */
  while (Date.now() < deadline) {
    if (await folderReady()) {
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
      const progress = JSON.stringify(jobs.map((job) => [job.status, job.progress?.current]));
      if (progress !== lastProgress) {
        lastProgress = progress;
        deadline = Date.now() + timeoutMs;
      }
      if (options?.onProgress) {
        const jobsWithProgress = jobs.filter((job) => job.progress?.total);
        if (jobsWithProgress.length) {
          const fraction = jobsWithProgress.reduce(
            (sum, job) => sum + job.progress!.current / job.progress!.total,
            0,
          ) / jobsWithProgress.length;
          const counts = jobsWithProgress.reduce(
            (sum, job) => ({
              current: sum.current + job.progress!.current,
              total: sum.total + job.progress!.total,
            }),
            { current: 0, total: 0 },
          );
          options.onProgress(fraction, counts);
        }
      }
      const allTerminal = jobs.every((job) => TERMINAL_JOB_STATUSES.includes(job.status));
      if (allTerminal) {
        const failed = jobs.filter((job) => job.status !== JobStatus.SUCCESS.value);
        if (failed.length) {
          const detail = failed.map((job) => job.title || 'processing job failed').join('; ');
          throw new Error(detail);
        }
        if (await folderReady()) {
          return;
        }
        throw new Error('Image processing finished but the camera folder has no viewable frames');
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }

  throw new Error('Timed out waiting for camera folder processing');
}
