import { computed, ref } from 'vue';
import { cloneDeep, isEqual } from 'lodash';
import type CameraStore from 'vue-media-annotator/CameraStore';
import type { MarkChangesPending } from 'vue-media-annotator/BaseAnnotationStore';
import Track, { Feature, TrackData } from 'vue-media-annotator/track';
import Group, { GroupData } from 'vue-media-annotator/Group';

type Location = { camera: string; kind: 'track' | 'group'; id: number };
type Snapshot = { index: number } & (
  { kind: 'track'; data: TrackData; set?: string }
  | { kind: 'group'; data: GroupData }
);
type Change = { location: Location; before?: Snapshot };

function locationKey(location: Location) {
  return JSON.stringify([location.camera, location.kind, location.id]);
}

/** Session-local, bounded undo history. Only changed annotations are copied per edit. */
export default class AnnotationHistory {
  private baseline = new Map<string, Snapshot>();

  private pending = new Map<string, Location>();

  private steps: Change[][] = [];

  private active = false;

  private restoring = false;

  private generation = 0;

  private count = ref(0);

  readonly busy = ref(0);

  readonly canUndo = computed(() => this.count.value > 0 && this.active && !this.busy.value);

  constructor(private cameras: CameraStore, private limit = 20) {
    if (limit < 1) throw new Error('Undo history must retain at least one edit');
  }

  private capture(location: Location): Snapshot | undefined {
    const camera = this.cameras.camMap.value.get(location.camera);
    if (location.kind === 'track') {
      const track = camera?.trackStore.getPossible(location.id);
      // Starting a tool creates an empty track; the first real shape is the edit.
      if (!track || !track.featureIndex.length) return undefined;
      return cloneDeep({
        kind: 'track',
        data: track.serialize(),
        set: track.set,
        index: camera!.trackStore.annotationIds.value.indexOf(location.id),
      });
    }
    const group = camera?.groupStore.getPossible(location.id);
    return group ? cloneDeep({
      kind: 'group',
      data: group.serialize(),
      index: camera!.groupStore.annotationIds.value.indexOf(location.id),
    }) : undefined;
  }

  private refreshPositions(locations: Location[]) {
    const stores = new Set<string>();
    locations.forEach(({ camera, kind }) => {
      const key = JSON.stringify([camera, kind]);
      if (stores.has(key)) return;
      stores.add(key);
      const store = this.cameras.camMap.value.get(camera)?.[kind === 'track' ? 'trackStore' : 'groupStore'];
      store?.annotationIds.value.forEach((id, index) => {
        const itemKey = locationKey({ camera, kind, id });
        const snapshot = this.baseline.get(itemKey);
        if (snapshot && snapshot.index !== index) {
          this.baseline.set(itemKey, { ...snapshot, index });
        }
      });
    });
  }

  /** Establish a baseline after loading; imported data is never an undo step. */
  start() {
    this.reset();
    this.cameras.camMap.value.forEach((camera, name) => {
      (['track', 'group'] as const).forEach((kind) => {
        const store = kind === 'track' ? camera.trackStore : camera.groupStore;
        store.annotationIds.value.forEach((id) => {
          const location = { camera: name, kind, id };
          const snapshot = this.capture(location);
          if (snapshot) this.baseline.set(locationKey(location), snapshot);
        });
      });
    });
    this.active = true;
  }

  reset() {
    this.active = false;
    this.generation += 1;
    this.baseline.clear();
    this.pending.clear();
    this.steps = [];
    this.count.value = 0;
    this.busy.value = 0;
  }

  record(change: Parameters<MarkChangesPending>[0]) {
    if (!this.active || this.restoring) return;
    const item = change.track ?? change.group;
    if (!item) return;
    const location: Location = {
      camera: change.cameraName, kind: change.track ? 'track' : 'group', id: item.id,
    };
    const alreadyScheduled = this.pending.size > 0;
    this.pending.set(locationKey(location), location);
    if (alreadyScheduled) return;
    // A single gesture can update bounds, geometry, attributes and both cameras.
    // Wait for all synchronous notifications before capturing its final state.
    const { generation } = this;
    Promise.resolve().then(() => {
      if (generation === this.generation) this.flush();
    });
  }

  flush() {
    if (this.busy.value || !this.active || this.restoring) return;
    const step: Change[] = [];
    this.pending.forEach((location, key) => {
      const before = this.baseline.get(key);
      const after = this.capture(location);
      if (!isEqual(before, after)) step.push({ location, before });
      if (after) this.baseline.set(key, after);
      else this.baseline.delete(key);
    });
    this.refreshPositions([...this.pending.values()]);
    this.pending.clear();
    if (step.length) {
      this.steps.push(step);
      if (this.steps.length > this.limit) this.steps.shift();
    }
    this.count.value = this.steps.length;
  }

  /** Keep asynchronous stereo results with the gesture that requested them. */
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const { generation } = this;
    this.busy.value += 1;
    try {
      return await operation();
    } finally {
      if (generation === this.generation) {
        this.busy.value -= 1;
        this.flush();
      }
    }
  }

  undo(prepare?: () => void): boolean {
    this.flush();
    if (!this.canUndo.value) return false;
    const step = this.steps.pop()!;
    this.restoring = true;
    try {
      prepare?.();
      // Remove all affected entries before restoring them in their original order.
      step.forEach(({ location }) => {
        const camera = this.cameras.camMap.value.get(location.camera)!;
        const store = location.kind === 'track' ? camera.trackStore : camera.groupStore;
        if (store.getPossible(location.id)) store.remove(location.id);
      });
      step.sort((a, b) => (a.before?.index ?? 0) - (b.before?.index ?? 0));
      step.forEach(({ location, before }) => {
        const key = locationKey(location);
        if (!before) {
          this.baseline.delete(key);
          return;
        }
        const camera = this.cameras.camMap.value.get(location.camera)!;
        const snapshot = cloneDeep(before);
        if (snapshot.kind === 'track') {
          const features: Feature[] = [];
          snapshot.data.features.forEach((feature) => { features[feature.frame] = feature; });
          // Do not use the import path, which normalizes/discards some geometry.
          camera.trackStore.insert(new Track(location.id, {
            ...snapshot.data, features, set: snapshot.set,
          }));
        } else {
          camera.groupStore.insert(Group.fromJSON(snapshot.data));
        }
        const store = location.kind === 'track' ? camera.trackStore : camera.groupStore;
        const ids = store.annotationIds.value;
        ids.splice(ids.indexOf(location.id), 1);
        ids.splice(Math.min(snapshot.index, ids.length), 0, location.id);
        this.baseline.set(key, before);
      });
      this.refreshPositions(step.map(({ location }) => location));
    } finally {
      this.restoring = false;
      this.count.value = this.steps.length;
    }
    return true;
  }
}
