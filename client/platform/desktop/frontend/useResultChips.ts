/**
 * Shared cache of cropped video search result chips (data URLs keyed by
 * result ref), used by both the Video Search side panel and the results
 * grid. Chips are cropped from source frames with some surrounding context
 * and the result box outlined, so a user can adjudicate results without
 * opening each source video.
 *
 * Track results can additionally load a small "sequence" of frames sampled
 * along the track (grid cells cycle through them). Sequence frames queue at
 * lower priority than primary chips so first paint stays fast.
 *
 * Loads are queued with limited concurrency: video-dataset results each
 * require an ffmpeg frame extraction on the backend, so firing a whole
 * grid page at once would spawn a process per cell.
 *
 * Cache entries are only valid within one query generation
 * (state.queryGeneration): the service can reuse refs and query ids
 * across queries, so ref alone is not a stable identity.
 */
import { ref, set, watch } from 'vue';
import type { VideoSearchResult, VideoSearchTrackState } from 'dive-common/apispec';
import { getMediaUrl } from 'platform/desktop/frontend/api';
import type { VideoSearchContextType } from 'platform/desktop/frontend/useVideoSearch';

/** Longest chip edge in pixels (source pixels are never upscaled). */
const ChipMaxDim = 320;
/** Context margin around the result box, as a fraction of its longest side. */
const ChipPadFraction = 0.25;
/** Maximum simultaneous chip loads. */
const ChipConcurrency = 4;
/** How many of the newest results the panel eagerly loads. */
const EagerLoadCount = 50;
/** Most frames sampled along a track for a cycling sequence. */
const MaxSequenceFrames = 8;

export function resultFrame(result: VideoSearchResult): number | null {
  return result.tracks[0]?.states[0]?.frame ?? result.start_frame ?? null;
}

function resultBox(result: VideoSearchResult) {
  return result.tracks[0]?.states[0]?.bbox;
}

/** Up to MaxSequenceFrames states evenly sampled along the result's track. */
function sequenceStates(result: VideoSearchResult): VideoSearchTrackState[] {
  const states = result.tracks[0]?.states ?? [];
  if (states.length < 2) return [];
  const count = Math.min(MaxSequenceFrames, states.length);
  const chosen: VideoSearchTrackState[] = [];
  const seenFrames = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const state = states[Math.round((i * (states.length - 1)) / (count - 1))];
    if (!seenFrames.has(state.frame)) {
      seenFrames.add(state.frame);
      chosen.push(state);
    }
  }
  return chosen.length > 1 ? chosen : [];
}

interface ChipJob {
  result: VideoSearchResult;
  frame: number;
  bbox: [number, number, number, number] | undefined;
  /** Sequence slot to fill, or null for the primary chip. */
  seqIdx: number | null;
  generation: number;
}

/** Sampled track frames in order; slots are null until their load lands. */
export type ChipSequence = Array<string | null>;

export function createResultChips(search: VideoSearchContextType) {
  const chips = ref<Record<string, string>>({});
  /**
   * Cycling frames for track results, sparse until loads complete
   * (unloaded slots are null and skipped by the cycling display).
   */
  const sequences = ref<Record<string, ChipSequence>>({});
  /** Refs whose primary chip load failed; shown as broken, not loading. */
  const failures = ref<Record<string, boolean>>({});
  /** Primary ref -> generation queued under. */
  const pending = new Map<string, number>();
  /** Refs whose sequence has been queued this generation. */
  const sequenceQueued = new Map<string, number>();
  const primaryQueue: ChipJob[] = [];
  const sequenceQueue: ChipJob[] = [];
  /** In-flight source frame loads shared between co-framed results. */
  const frameLoads = new Map<string, Promise<HTMLImageElement>>();
  let generation = search.state.queryGeneration;
  let active = 0;

  function loadFrameImage(dsId: string, frameNum: number): Promise<HTMLImageElement> {
    const key = `${dsId}:${frameNum}`;
    const inflight = frameLoads.get(key);
    if (inflight) return inflight;
    const load = (async () => {
      const imagePath = await search.imageForDatasetFrame(dsId, frameNum);
      const url = await getMediaUrl(imagePath);
      const image = new Image();
      image.src = url;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      return image;
    })();
    frameLoads.set(key, load);
    load.finally(() => frameLoads.delete(key)).catch(() => undefined);
    return load;
  }

  /** Crop one frame of a result into a chip data URL. */
  async function loadChip(job: ChipJob): Promise<string | null> {
    const resultDataset = search.resultDatasetId(job.result);
    if (!resultDataset) return null;
    const image = await loadFrameImage(resultDataset, job.frame);
    const { bbox } = job;
    const [bx1, by1, bx2, by2] = bbox ?? [0, 0, image.naturalWidth, image.naturalHeight];
    const bw = Math.max(1, bx2 - bx1);
    const bh = Math.max(1, by2 - by1);
    const pad = bbox ? ChipPadFraction * Math.max(bw, bh) : 0;
    const x1 = Math.max(0, Math.floor(bx1 - pad));
    const y1 = Math.max(0, Math.floor(by1 - pad));
    const x2 = Math.min(image.naturalWidth, Math.ceil(bx2 + pad));
    const y2 = Math.min(image.naturalHeight, Math.ceil(by2 + pad));
    const w = Math.max(1, x2 - x1);
    const h = Math.max(1, y2 - y1);
    const scale = Math.min(1, ChipMaxDim / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, x1, y1, w, h, 0, 0, canvas.width, canvas.height);
    if (bbox) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = Math.max(1, Math.round(Math.max(canvas.width, canvas.height) / 160));
      ctx.strokeRect((bx1 - x1) * scale, (by1 - y1) * scale, bw * scale, bh * scale);
    }
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  function completeJob(job: ChipJob, dataUrl: string | null) {
    if (job.generation !== generation) return;
    if (job.seqIdx === null) {
      if (dataUrl) {
        set(chips.value, job.result.ref, dataUrl);
      } else {
        set(failures.value, job.result.ref, true);
      }
    } else if (dataUrl) {
      // Failed sequence slots just stay null; cycling skips them.
      const slots = sequences.value[job.result.ref];
      if (slots) set(slots, job.seqIdx, dataUrl);
    }
  }

  function pump() {
    if (active >= ChipConcurrency) return;
    // Primary chips always drain before sequence frames.
    const job = primaryQueue.shift() ?? sequenceQueue.shift();
    if (!job) return;
    active += 1;
    loadChip(job)
      .then((dataUrl) => completeJob(job, dataUrl))
      // Chips are best-effort; failed cells render a broken-image state.
      .catch(() => completeJob(job, null))
      .finally(() => {
        active -= 1;
        // Only clear the entry this load owns: a new query may have
        // re-queued the same ref while this load was in flight.
        if (job.seqIdx === null && pending.get(job.result.ref) === job.generation) {
          pending.delete(job.result.ref);
        }
        pump();
      });
    pump();
  }

  /** Queue primary chip loads for any given results not already handled. */
  function ensure(results: VideoSearchResult[]) {
    results.forEach((result) => {
      if (chips.value[result.ref] || failures.value[result.ref]) return;
      if (pending.has(result.ref)) return;
      const frame = resultFrame(result);
      if (frame === null) return;
      pending.set(result.ref, generation);
      primaryQueue.push({
        result, frame, bbox: resultBox(result), seqIdx: null, generation,
      });
    });
    pump();
  }

  /**
   * Queue cycling-sequence frames for track results (call with just the
   * visible results: each frame can cost a backend ffmpeg extraction).
   */
  function ensureSequences(results: VideoSearchResult[]) {
    results.forEach((result) => {
      if (sequenceQueued.get(result.ref) === generation) return;
      const states = sequenceStates(result);
      if (!states.length) return;
      sequenceQueued.set(result.ref, generation);
      // Fixed-size null-filled slots so consumers can see the sequence
      // length immediately and display frames as they arrive.
      set(sequences.value, result.ref, states.map((): string | null => null));
      states.forEach((state, seqIdx) => {
        sequenceQueue.push({
          result, frame: state.frame, bbox: state.bbox, seqIdx, generation,
        });
      });
    });
    pump();
  }

  // Immediate so results that predate this store (e.g. the panel was
  // toggled closed and back open) still get their chips loaded.
  watch(() => search.state.results, (results) => {
    if (search.state.queryGeneration !== generation) {
      // New query: refs may repeat with different content, so start over.
      generation = search.state.queryGeneration;
      chips.value = {};
      sequences.value = {};
      failures.value = {};
      primaryQueue.length = 0;
      sequenceQueue.length = 0;
      pending.clear();
      sequenceQueued.clear();
    }
    // Refinement re-ranks within the same query; cached chips stay valid.
    ensure(results.slice(0, EagerLoadCount));
  }, { immediate: true });

  return {
    chips, sequences, failures, ensure, ensureSequences,
  };
}

export type ResultChipStore = ReturnType<typeof createResultChips>;
