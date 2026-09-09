/**
 * Reactive cache of rendered chips for review items, filled by a small
 * priority queue: the first box of every requested item ("primary") is
 * rendered before any of the extra frames a track cycles through
 * ("sequence"), so a page paints as fast as possible and then animates.
 *
 * Loads run with limited concurrency: a video dataset decodes frames by
 * seeking one hidden element, and image sequences would otherwise fire a
 * whole page of requests at once.
 */
import { ref, set } from 'vue';
import type { FrameSource } from './frameSource';
import { renderChip } from './chipRenderer';
import type { ReviewItem } from './types';

export interface ChipStoreOptions {
  padding: number;
  size: number;
  /** Chip width / height, matching the cells the chips are shown in. */
  aspect: number;
  outline: string;
}

export interface ChipStoreDeps {
  /**
   * Frame access for a dataset; null when the dataset cannot be cropped.
   * May resolve lazily (e.g. loading the dataset's config on first use).
   */
  frameSourceFor(datasetId: string): FrameSource | null | Promise<FrameSource | null>;
  concurrency?: number;
}

interface ChipJob {
  item: ReviewItem;
  /** Sequence slot to fill, or null for the primary chip. */
  slot: number | null;
  generation: number;
}

export type ChipSequence = Array<string | null>;

export function createChipStore(deps: ChipStoreDeps, initial: ChipStoreOptions) {
  const concurrency = deps.concurrency ?? 4;
  const chips = ref<Record<string, string>>({});
  const sequences = ref<Record<string, ChipSequence>>({});
  const failures = ref<Record<string, string>>({});
  let options: ChipStoreOptions = { ...initial };
  let generation = 0;
  let active = 0;
  const primaryQueue: ChipJob[] = [];
  const sequenceQueue: ChipJob[] = [];
  /** Item keys with a primary job queued or running, and its generation. */
  const pendingPrimary = new Map<string, number>();
  const sequenceQueued = new Map<string, number>();

  function reset() {
    generation += 1;
    chips.value = {};
    sequences.value = {};
    failures.value = {};
    primaryQueue.length = 0;
    sequenceQueue.length = 0;
    pendingPrimary.clear();
    sequenceQueued.clear();
  }

  /** Re-render everything when the crop or resolution changes. */
  function setOptions(next: ChipStoreOptions) {
    if (next.padding === options.padding && next.size === options.size
      && next.aspect === options.aspect && next.outline === options.outline) {
      return;
    }
    options = { ...next };
    reset();
  }

  async function render(job: ChipJob): Promise<string> {
    const source = await deps.frameSourceFor(job.item.datasetId);
    if (!source) throw new Error('Media for this dataset cannot be cropped');
    const frameRef = job.slot === null ? job.item.primary : job.item.frames[job.slot];
    const frame = await source.getFrame(frameRef.frame);
    return renderChip(frame, frameRef.bounds, options);
  }

  function complete(job: ChipJob, dataUrl: string | null, error?: unknown) {
    if (job.generation !== generation) return;
    const { key } = job.item;
    if (job.slot === null) {
      if (dataUrl) {
        set(chips.value, key, dataUrl);
      } else {
        set(failures.value, key, error instanceof Error ? error.message : 'Could not render this chip');
      }
    } else if (dataUrl) {
      const slots = sequences.value[key];
      if (slots) set(slots, job.slot, dataUrl);
    }
  }

  function finish(job: ChipJob) {
    active -= 1;
    if (job.slot === null && pendingPrimary.get(job.item.key) === job.generation) {
      pendingPrimary.delete(job.item.key);
    }
    pump();
  }

  function start(job: ChipJob) {
    active += 1;
    render(job)
      .then((dataUrl) => complete(job, dataUrl))
      .catch((err) => complete(job, null, err))
      .finally(() => finish(job));
  }

  function pump() {
    while (active < concurrency) {
      const job = primaryQueue.shift() ?? sequenceQueue.shift();
      if (!job) return;
      start(job);
    }
  }

  /** Queue the first box of each item not already rendered or queued. */
  function ensurePrimary(items: readonly ReviewItem[]) {
    items.forEach((item) => {
      if (chips.value[item.key] || failures.value[item.key]) return;
      if (pendingPrimary.get(item.key) === generation) return;
      pendingPrimary.set(item.key, generation);
      primaryQueue.push({ item, slot: null, generation });
    });
    pump();
  }

  /**
   * Queue the cycling frames of track items. Call with just the visible
   * page: every frame of a video dataset costs a seek.
   */
  function ensureSequences(items: readonly ReviewItem[]) {
    items.forEach((item) => {
      if (item.frames.length < 2) return;
      if (sequenceQueued.get(item.key) === generation) return;
      sequenceQueued.set(item.key, generation);
      // Fixed-size, null-filled so cells can show frames as they arrive.
      set(sequences.value, item.key, item.frames.map((): string | null => null));
      item.frames.forEach((_, slot) => {
        sequenceQueue.push({ item, slot, generation });
      });
    });
    pump();
  }

  /** Drop queued work that is no longer visible (rendered chips stay cached). */
  function trimQueues(visibleKeys: ReadonlySet<string>) {
    const keep = (job: ChipJob) => visibleKeys.has(job.item.key);
    const droppedPrimary = primaryQueue.filter((job) => !keep(job));
    droppedPrimary.forEach((job) => {
      if (pendingPrimary.get(job.item.key) === job.generation) pendingPrimary.delete(job.item.key);
    });
    primaryQueue.splice(0, primaryQueue.length, ...primaryQueue.filter(keep));
    const droppedSequence = sequenceQueue.filter((job) => !keep(job));
    droppedSequence.forEach((job) => {
      sequenceQueued.delete(job.item.key);
      if (job.generation === generation) {
        const slots = sequences.value;
        delete slots[job.item.key];
      }
    });
    sequenceQueue.splice(0, sequenceQueue.length, ...sequenceQueue.filter(keep));
  }

  return {
    chips,
    sequences,
    failures,
    setOptions,
    ensurePrimary,
    ensureSequences,
    trimQueues,
    reset,
    get options() { return options; },
  };
}

export type ChipStore = ReturnType<typeof createChipStore>;
