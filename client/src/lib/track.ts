import { ref, Ref } from '@vue/composition-api';
import { timeHours } from 'd3';

export type ConfidencePair = [string, number];
export type TrackId = number;

interface StringKeyObject {
  [key: string]: unknown;
}

export interface Feature {
  frame: number;
  bounds?: Array<number>;
  fishLength?: number;
  attributes?: object;
  head?: [number, number];
  tail?: [number, number];
}

export interface TrackData {
  trackId: TrackId;
  meta: StringKeyObject;
  attributes: StringKeyObject;
  confidencePairs: Array<ConfidencePair>;
  features: Array<Feature>;
  begin: number;
  end: number;
}

interface Observer {
  (track: Track): void;
}

interface TrackParams {
  meta?: StringKeyObject;
  begin?: number;
  end?: number;
  features?: Array<Feature>;
  confidencePairs?: Array<ConfidencePair>;
  attributes?: StringKeyObject;
}

export default class Track {
  trackId: Ref<TrackId>;

  meta: Ref<StringKeyObject>;

  attributes: Ref<StringKeyObject>;

  confidencePairs: Ref<Array<ConfidencePair>>;

  features: Array<Feature>;

  begin: Ref<number>;

  end: Ref<number>;

  revision: Ref<number>;

  observers: Array<Observer>;

  constructor(trackId: TrackId, {
    meta = {},
    begin = Infinity,
    end = 0,
    features = [],
    confidencePairs = [],
    attributes = {},
  }: TrackParams) {
    this.trackId = ref(trackId);
    this.meta = ref(meta);
    this.attributes = ref(attributes);
    this.features = features; // NON-reactive sparse array
    this.begin = ref(begin);
    this.end = ref(end);
    this.revision = ref(0);
    this.observers = [];
    this.confidencePairs = ref(confidencePairs);
  }

  private updateBounds(frame: number) {
    if (frame < this.begin.value) {
      this.begin.value = frame;
    } else if (frame > this.end.value) {
      this.end.value = frame;
    }
  }

  /* TODO p2: register and unregister methods for observers */

  notify() {
    this.observers.forEach((o) => o(this));
  }

  setFeature(feature: Feature): Feature {
    const f = this.features[feature.frame] || {};
    this.features[feature.frame] = {
      ...f,
      ...feature,
    };
    this.updateBounds(feature.frame);
    this.notify();
    return this.features[feature.frame];
  }

  setType(trackType: string) {
    const i = this.confidencePairs.value.findIndex(([name, _val]) => name === trackType);
    const deleteCount = i >= 0 ? 1 : 0;
    this.confidencePairs.value.splice(
      deleteCount ? i : 0,
      deleteCount,
      [trackType, 1],
    );
    // sort by confidence value
    this.confidencePairs.value.sort((a, b) => a[1] - b[1]);
  }

  setAttribute(key: string, value: unknown) {
    this.attributes.value[key] = value;
    this.notify();
  }

  /* TODO p2: feature interpolation given frame */

  getFeature(frame: number): Feature | null {
    const maybeFrame = this.features[frame];
    return maybeFrame || null;
  }

  /* Serialize back to a regular track object */
  serialize(): TrackData {
    return {
      trackId: this.trackId.value,
      meta: this.meta.value,
      attributes: this.attributes.value,
      confidencePairs: this.confidencePairs.value,
      features: this.features,
      begin: this.begin.value,
      end: this.end.value,
    };
  }

  static fromJSON(json: TrackData): Track {
    const sparseFeatures: Array<Feature> = [];
    json.features.forEach((f) => { sparseFeatures[f.frame] = f; });
    const track = new Track(json.trackId, {
      features: sparseFeatures,
      meta: json.meta,
      attributes: json.attributes,
      confidencePairs: json.confidencePairs,
      begin: json.begin,
      end: json.end,
    });
    return track;
  }
}
