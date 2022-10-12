import { Ref, ref } from '@vue/composition-api';

export type ConfidencePair = [string, number];
export type AnnotationId = number;
export interface NotifierFuncParams<T> {
  item: T; event: string; oldValue: unknown;
}

type NotifierFunc<T> = (params: NotifierFuncParams<T>) => void;
export interface StringKeyObject {
  [key: string]: unknown;
}

/** BaseData is the json schema base transport */
export interface BaseData {
  id: AnnotationId;
  meta?: StringKeyObject;
  attributes: StringKeyObject;
  confidencePairs: Array<ConfidencePair>;
  begin: number;
  end: number;
}

/* Constructor params for Track */
export interface BaseAnnotationParams {
  meta?: StringKeyObject;
  begin?: number;
  end?: number;
  confidencePairs?: Array<ConfidencePair>;
  attributes?: StringKeyObject;
}

/**
 * Track manages the state of a track, its
 * frame data, and all metadata.
 */
export default abstract class BaseAnnotation {
  id: AnnotationId;

  meta?: StringKeyObject;

  attributes: StringKeyObject;

  confidencePairs: ConfidencePair[];

  begin: number;

  end: number;

  /**
   * Be very careful with revision!  It is expensive to use,
   * and should only be used for reactivity on a single track
   * rather than within the context of a loop.
   */
  revision: Ref<number>;

  /** A callback to notify about changes to the track. */
  notifier?: NotifierFunc<this>;

  /** Enables/Disables the notifier specifically for multicam merge */
  notifierEnabled: boolean;

  constructor(id: AnnotationId, {
    meta = {},
    begin = Infinity,
    end = 0,
    confidencePairs = [],
    attributes = {},
  }: BaseAnnotationParams) {
    this.id = id;
    this.meta = meta;
    this.attributes = attributes;
    this.revision = ref(1);
    this.begin = begin;
    this.end = end;
    this.confidencePairs = confidencePairs;
    this.notifierEnabled = true;
  }

  get length() {
    return (this.end - this.begin) + 1;
  }

  // eslint-disable-next-line class-methods-use-this
  protected isInitialized() {
    return true;
  }

  protected depend() {
    return this.revision.value;
  }

  /* Call if the bounds were possibly expanded */
  protected maybeExpandBounds(frame: number) {
    const oldval = [this.begin, this.end];
    if (frame < this.begin) {
      // frame below begin
      this.begin = frame;
      this.notify('bounds', oldval);
    } else if (frame > this.end) {
      // frame above end
      this.end = frame;
      this.notify('bounds', oldval);
    }
  }

  protected notify(name: string, oldValue: unknown = undefined) {
    /* Prevent broadcast until the first feature is initialized */
    if (this.isInitialized() && this.notifierEnabled) {
      this.revision.value += 1;
      if (this.notifier) {
        this.notifier({
          item: this,
          event: name,
          oldValue,
        });
      }
    }
  }

  setNotifier(notifier?: NotifierFunc<this>) {
    this.notifier = notifier;
  }

  getType(index = 0): [string, number] {
    if (this.confidencePairs.length > 0 && this.confidencePairs[index]) {
      return this.confidencePairs[index];
    }
    throw new Error('Index Error: The requested confidencePairs index does not exist.');
  }

  removeTypes(types: string[]) {
    if (this.confidencePairs.length > 0) {
      const old = this.confidencePairs;
      this.confidencePairs = this.confidencePairs.filter(
        ([type]) => !types.includes(type),
      );
      this.notify('confidencePairs', old);
    }
    return this.confidencePairs;
  }

  setType(annotationType: string, confidenceVal = 1, replace?: string) {
    const old = this.confidencePairs;
    if (confidenceVal >= 1) {
      // dont' allow confidence greater than 1
      this.confidencePairs = [[annotationType, 1]];
    } else {
      const index = this.confidencePairs.findIndex(([a]) => a === annotationType);
      this.confidencePairs.splice(index, index >= 0 ? 1 : 0, [annotationType, confidenceVal]);
      if (replace) {
        const replaceIndex = this.confidencePairs.findIndex(([a]) => a === replace);
        if (replaceIndex >= 0) this.confidencePairs.splice(replaceIndex, 1);
      }
      this.confidencePairs.sort((a, b) => b[1] - a[1]);
    }
    this.notify('confidencePairs', old);
  }

  setAttribute(key: string, value: unknown) {
    const oldval = this.attributes[key];
    this.attributes[key] = value;
    this.notify('attributes', { key, value: oldval });
  }

  /**
   * Figure out if any confidence pairs are above any corresponding thresholds
   */
  static exceedsThreshold(
    pairs: Array<ConfidencePair>, thresholds: Record<string, number>,
  ): Array<ConfidencePair> {
    const defaultThresh = thresholds.default || 0;
    return pairs.filter(([name, value]) => value >= (thresholds[name] || defaultThresh));
  }
}
