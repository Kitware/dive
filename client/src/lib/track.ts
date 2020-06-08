import Vue from 'vue';
import { ref, Ref } from '@vue/composition-api';
import { RectBounds } from '@/utils';

export type ConfidencePair = [string, number];
export type TrackId = number;

export interface StringKeyObject {
  [key: string]: unknown;
}

export interface Feature {
  frame: number;
  bounds?: RectBounds;
  fishLength?: number;
  attributes?: StringKeyObject;
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

interface TrackParams {
  meta?: StringKeyObject;
  begin?: number;
  end?: number;
  features?: Array<Feature>;
  confidencePairs?: Array<ConfidencePair>;
  attributes?: StringKeyObject;
}

/**
 * Track manages the state of a track, its
 * frame data, and all metadata.  Some of its properties are
 * reactive, others avoid reactivity for performance reasons.
 * A track instance should never be returned by reference in
 * a computed property to prevent deep reactivity from being
 * applied.  Instead, return dereferenced values individually.
 *
 * Track extends Vue exclusively for $on and $emit.  No other
 * uses of the vue superclass are expected.
 */
export default class Track {
  trackId: TrackId;

  meta: StringKeyObject;

  attributes: StringKeyObject;

  confidencePairs: ConfidencePair[];

  features: Feature[];

  begin: number;

  end: number;

  revision: Ref<number>;

  bus: Vue;

  constructor(trackId: TrackId, {
    meta = {},
    begin = Infinity,
    end = 0,
    features = [],
    confidencePairs = [],
    attributes = {},
  }: TrackParams) {
    this.bus = new Vue();
    this.trackId = trackId;
    this.meta = meta;
    this.attributes = attributes;
    this.features = features; // NON-reactive sparse array
    this.begin = begin;
    this.end = end;
    this.revision = ref(0);
    this.confidencePairs = confidencePairs;
  }

  private updateBounds(frame: number) {
    if (frame < this.begin) {
      const oldval = this.begin;
      this.begin = frame;
      this.notify('bounds', [oldval, this.end]);
    } else if (frame > this.end) {
      const oldval = this.end;
      this.end = frame;
      this.notify('bounds', [this.begin, oldval]);
    }
  }

  // private $emit()

  /**
   * @param name an event name
   * @param oldValue the value before the change being notified.
   */
  private notify(name: string, oldValue: unknown) {
    this.bus.$emit('notify', {
      track: this,
      event: name,
      oldValue,
    });
  }

  setFeature(feature: Feature): Feature {
    const f = this.features[feature.frame] || {};
    this.features[feature.frame] = {
      ...f,
      ...feature,
    };
    this.updateBounds(feature.frame);
    this.notify('feature', f);
    return this.features[feature.frame];
  }

  setFeatureAttribute(frame: number, name: string, value: unknown) {
    if (this.features[frame]) {
      this.features[frame].attributes = {
        ...this.features[frame].attributes,
        [name]: value,
      };
      this.notify('feature', this.features[frame]);
    }
  }

  getType(): [string, number] | null {
    if (this.confidencePairs.length > 0) {
      return this.confidencePairs[0];
    }
    return null;
  }

  setType(trackType: string) {
    const old = this.confidencePairs;
    this.confidencePairs = [[trackType, 1]];
    this.notify('confidencePairs', old);
  }

  setAttribute(key: string, value: unknown) {
    const oldval = this.attributes[key];
    this.attributes[key] = value;
    this.notify('attributes', { key, value: oldval });
  }

  /* TODO p2: feature interpolation given frame */

  getFeature(frame: number): Feature | null {
    const maybeFrame = this.features[frame];
    return maybeFrame || null;
  }

  /* Condense the sparse array to a dense one */
  getCondenseFeatures(): Feature[] {
    const features = [] as Feature[];
    this.features.forEach((f) => {
      features.push(f);
    });
    return features;
  }

  /* Serialize back to a regular track object */
  serialize(): TrackData {
    return {
      trackId: this.trackId,
      meta: this.meta,
      attributes: this.attributes,
      confidencePairs: this.confidencePairs,
      features: this.getCondenseFeatures(),
      begin: this.begin,
      end: this.end,
    };
  }

  static fromJSON(json: TrackData): Track {
    const sparseFeatures: Array<Feature> = [];
    json.features.forEach((f) => { sparseFeatures[f.frame] = f; });
    // accept either number or string, convert to number
    const intTrackId = parseInt(json.trackId.toString(), 10);
    const track = new Track(intTrackId, {
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
