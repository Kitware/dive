import { watch } from 'vue';
import type { PipelineJobResult } from 'dive-common/apispec';
import {
  isJobFinished, jobCanceled, jobSucceeded, useJobs,
} from 'platform/web-girder/store/useJobs';

/**
 * Resolve once the pipeline job launched on `datasetId` reaches a terminal state.
 *
 * The job feed is the only thing that knows a job ended: a pipeline's own output
 * cannot say it, because a deterministic re-run writes byte-identical results and
 * a failed job writes nothing at all -- both look exactly like "still running" to
 * anything watching the dataset. Without this, the Auto Register panel falls back
 * to polling the registration meta, which reports a failed job as still running
 * until its 30 minute timeout.
 *
 * The store keeps one job per dataset (the latest), so a job that had already
 * finished when the watch started is skipped by id: only a different job can be
 * the one just launched. That single slot is also why the pipeline is not matched
 * on -- two pipelines running on one dataset at once are indistinguishable here,
 * and the caller launches exactly one.
 */
export default function watchPipelineJob(datasetId: string): Promise<PipelineJobResult> {
  const jobs = useJobs();
  const initial = jobs.datasetStatus.value[datasetId];
  const staleJobId = initial && isJobFinished(initial.status) ? initial.jobId : null;
  return new Promise<PipelineJobResult>((resolve) => {
    let stop: (() => void) | undefined;
    let settled = false;
    const settle = (result: PipelineJobResult) => {
      if (settled) {
        return;
      }
      settled = true;
      // Undefined while the immediate run is still inside watch(); stopped by
      // the caller below in that case.
      stop?.();
      resolve(result);
    };
    stop = watch(
      () => jobs.datasetStatus.value[datasetId],
      (entry) => {
        if (!entry || !isJobFinished(entry.status) || entry.jobId === staleJobId) {
          return;
        }
        if (jobSucceeded(entry.status)) {
          settle({ ok: true });
          return;
        }
        settle({
          ok: false,
          message: jobCanceled(entry.status)
            ? 'The job was canceled.'
            : 'The job failed; see its log in the Jobs tab.',
        });
      },
      { immediate: true, deep: true },
    );
    if (settled) {
      stop();
    }
  });
}
