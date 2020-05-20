import { ref, Ref } from '@vue/composition-api';

type ConfidencePair = [string, number];

interface StringKeyObject {
  [key: string]: any;
}

export interface IFeature {
  frame: number;
  bounds?: Array<Number>;
  fishLength?: Number;
  attributes?: object;
  head?: [number, number];
  tail?: [number, number];
}

export interface ITrack {
  trackId: string
  meta: object;
  attributes: object;
  confidencePairs: Array<ConfidencePair>;
  features: Array<IFeature>;
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
  features?: Array<IFeature>;
  confidencePairs?: Array<ConfidencePair>;
  attributes?: StringKeyObject;
}

export default class Track {
  trackId: Ref<string>;

  meta: Ref<StringKeyObject>;

  attributes: Ref<StringKeyObject>;

  confidencePairs: Ref<Array<ConfidencePair>>;

  features: Array<IFeature>;

  begin: Ref<number>;

  end: Ref<number>;

  revision: Ref<number>;

  observers: Array<Observer>;

  constructor(trackId: string, {
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

  /* TODO p2: register and unregister methods for observers */

  notify() {
    this.observers.forEach((o) => o(this));
  }

  setFeature(feature: IFeature): IFeature {
    const f = this.features[feature.frame] || {};
    this.features[feature.frame] = {
      ...f,
      ...feature,
    };
    this.notify();
    return this.features[feature.frame];
  }

  setType(trackType: string) {
    this.confidencePairs.value.forEach(() => {
      // TODO p1
    });
    return null;
  }

  setAttribute(key: string, value: any) {
    this.attributes.value[key] = value;
    this.notify();
  }

  /* TODO p1: feature interpolation given frame */

  getFeature(frame: number): IFeature | null {
    const maybeFrame = this.features[frame];
    return maybeFrame || null;
  }

  /* Serialize back to a regular track object */
  serialize(): ITrack {
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

  static fromJSON(json: ITrack): Track {
    const sparseFeatures: Array<IFeature> = [];
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
