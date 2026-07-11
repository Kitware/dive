/**
 * Shared cache of cropped video search result chips (data URLs keyed by
 * result ref), used by both the Video Search side panel and the results
 * grid. Chips are cropped from source frames with some surrounding context
 * and the result box outlined, so a user can adjudicate results without
 * opening each source video.
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
import type { VideoSearchResult } from 'dive-common/apispec';
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

export function resultFrame(result: VideoSearchResult): number | null {
  return result.tracks[0]?.states[0]?.frame ?? result.start_frame ?? null;
}

function resultBox(result: VideoSearchResult) {
  return result.tracks[0]?.states[0]?.bbox;
}

export function createResultChips(search: VideoSearchContextType) {
  const chips = ref<Record<string, string>>({});
  /** Refs whose chip load failed; shown as broken rather than loading. */
  const failures = ref<Record<string, boolean>>({});
  /** ref -> generation it was queued under. */
  const pending = new Map<string, number>();
  const queue: VideoSearchResult[] = [];
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

  /** Crop a result chip out of its source frame into a data URL. */
  async function loadChip(result: VideoSearchResult): Promise<string | null> {
    const frameNum = resultFrame(result);
    if (frameNum === null) return null;
    const resultDataset = search.resultDatasetId(result);
    if (!resultDataset) return null;
    const image = await loadFrameImage(resultDataset, frameNum);
    const bbox = resultBox(result);
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

  function pump() {
    if (active >= ChipConcurrency) return;
    const result = queue.shift();
    if (!result) return;
    const queuedGeneration = pending.get(result.ref);
    active += 1;
    loadChip(result)
      .then((dataUrl) => {
        if (dataUrl && queuedGeneration === generation) {
          set(chips.value, result.ref, dataUrl);
        }
      })
      // Chips are best-effort; failed cells render a broken-image state.
      .catch(() => {
        if (queuedGeneration === generation) {
          set(failures.value, result.ref, true);
        }
      })
      .finally(() => {
        active -= 1;
        // Only clear the entry this load owns: a new query may have
        // re-queued the same ref while this load was in flight.
        if (pending.get(result.ref) === queuedGeneration) {
          pending.delete(result.ref);
        }
        pump();
      });
    pump();
  }

  /** Queue chip loads for any of the given results not already handled. */
  function ensure(results: VideoSearchResult[]) {
    results.forEach((result) => {
      if (chips.value[result.ref] || failures.value[result.ref]) return;
      if (pending.has(result.ref)) return;
      pending.set(result.ref, generation);
      queue.push(result);
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
      failures.value = {};
      queue.length = 0;
      pending.clear();
    }
    // Refinement re-ranks within the same query; cached chips stay valid.
    ensure(results.slice(0, EagerLoadCount));
  }, { immediate: true });

  return { chips, failures, ensure };
}

export type ResultChipStore = ReturnType<typeof createResultChips>;
