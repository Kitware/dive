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
import { ref, set, del } from 'vue';
import type { FrameSource } from './frameSource';
import { renderChip, ChipTransform, RenderedChip } from './chipRenderer';
import type { ReviewItem } from './types';

export interface ChipStoreOptions {
  padding: number;
  size: number;
  /** Chip width / height, matching the cells the chips are shown in. */
  aspect: number;
  outline: string;
}

export interface ChipStoreDeps {
  /** Frame access for a dataset; null when the dataset cannot be cropped. */
  frameSourceFor(datasetId: string): FrameSource | null;
  concurrency?: number;
  /** Retain recent rendered items when paging; visible items are always kept. */
  cacheSize?: number;
}

interface ChipJob {
  item: ReviewItem;
  /** Sequence slot to fill, or null for the primary chip. */
  slot: number | null;
  generation: number;
}

export type ChipSequence = Array<string | null>;
export type ChipTransformSequence = Array<ChipTransform | null>;

export function createChipStore(deps: ChipStoreDeps, initial: ChipStoreOptions) {
  const concurrency = deps.concurrency ?? 4;
  const chips = ref<Record<string, string>>({});
  const sequences = ref<Record<string, ChipSequence>>({});
  const failures = ref<Record<string, string>>({});
  /** How each rendered chip maps to its frame, for overlays and editing. */
  const transforms = ref<Record<string, ChipTransform>>({});
  const sequenceTransforms = ref<Record<string, ChipTransformSequence>>({});
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
    transforms.value = {};
    sequenceTransforms.value = {};
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

  async function render(job: ChipJob): Promise<RenderedChip> {
    const source = deps.frameSourceFor(job.item.datasetId);
    if (!source) throw new Error('Media for this dataset cannot be cropped');
    const frameRef = job.slot === null ? job.item.primary : job.item.frames[job.slot];
    const frame = await source.getFrame(frameRef.frame);
    return renderChip(frame, frameRef.bounds, options);
  }

  function complete(job: ChipJob, rendered: RenderedChip | null, error?: unknown) {
    if (job.generation !== generation) return;
    const { key } = job.item;
    if (job.slot === null) {
      if (rendered) {
        set(chips.value, key, rendered.dataUrl);
        set(transforms.value, key, rendered.transform);
      } else {
        set(failures.value, key, error instanceof Error ? error.message : 'Could not render this chip');
      }
    } else if (rendered) {
      const slots = sequences.value[key];
      if (slots) set(slots, job.slot, rendered.dataUrl);
      const slotTransforms = sequenceTransforms.value[key];
      if (slotTransforms) set(slotTransforms, job.slot, rendered.transform);
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
      .then((rendered) => complete(job, rendered))
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
      set(sequenceTransforms.value, item.key, item.frames.map((): ChipTransform | null => null));
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
        del(sequences.value, job.item.key);
        del(sequenceTransforms.value, job.item.key);
      }
    });
    sequenceQueue.splice(0, sequenceQueue.length, ...sequenceQueue.filter(keep));
    const cached = [...Object.keys(chips.value), ...Object.keys(failures.value)];
    const excess = Math.max(0, cached.length - Math.max(deps.cacheSize ?? 256, visibleKeys.size));
    cached.filter((key) => !visibleKeys.has(key)).slice(0, excess).forEach(invalidate);
  }

  /**
   * Forget an item's chips (its boxes changed) so the next ensure call
   * renders them again. Queued work for the item is dropped too.
   */
  function invalidate(key: string) {
    del(chips.value, key);
    del(failures.value, key);
    del(transforms.value, key);
    del(sequences.value, key);
    del(sequenceTransforms.value, key);
    pendingPrimary.delete(key);
    sequenceQueued.delete(key);
    primaryQueue.splice(0, primaryQueue.length, ...primaryQueue.filter((job) => job.item.key !== key));
    sequenceQueue.splice(0, sequenceQueue.length, ...sequenceQueue.filter((job) => job.item.key !== key));
  }

  return {
    chips,
    sequences,
    failures,
    transforms,
    sequenceTransforms,
    setOptions,
    ensurePrimary,
    ensureSequences,
    trimQueues,
    invalidate,
    reset,
    get options() { return options; },
  };
}

export type ChipStore = ReturnType<typeof createChipStore>;
