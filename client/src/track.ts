import { RectBounds } from './utils';
import {
  binarySearch,
  listInsert,
  getSurroundingElements,
  listRemove,
} from './listUtils';
import BaseAnnotation, {
  AnnotationId, BaseAnnotationParams, BaseData, StringKeyObject,
} from './BaseAnnotation';

export type InterpolateFeatures = [Feature | null, Feature | null, Feature | null];
/** @deprecated use AnnotationId instead */
export type TrackId = number;
export type TrackSupportedFeature = (
  GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point);

/* Frame feature for both TrackData and Track */
export interface Feature {
  frame: number;
  flick?: Readonly<number>;
  interpolate?: boolean;
  keyframe?: boolean;
  bounds?: RectBounds;
  geometry?: GeoJSON.FeatureCollection<TrackSupportedFeature>;
  fishLength?: number;
  attributes?: StringKeyObject;
  head?: [number, number];
  tail?: [number, number];
}

/** TrackData is the json schema for Track transport */
export interface TrackData extends BaseData {
  features: Array<Feature>;
}

/* Constructor params for Track */
interface TrackParams extends BaseAnnotationParams {
  features?: Array<Feature>;
}

/**
 * Track manages the state of a track, its
 * frame data, and all metadata.
 */
export default class Track extends BaseAnnotation {
  /* Sparse array maps frame # to feature object */
  features: Feature[];

  /**
   * Sorted dense array of frame indices into this.features
   * for performing fast search */
  featureIndex: number[];

  constructor(id: AnnotationId, params: TrackParams) {
    super(id, params);
    this.features = params.features || []; // NON-reactive sparse array
    this.featureIndex = [];
    Track.sanityCheckFeatures(this.features);
    this.repopulateInterpolatedFrames(this.features);
  }

  /**
   * @deprecated Use id instead.
   */
  public get trackId() {
    return this.id;
  }

  /**
   * True after at least 1 feature has been added
   */
  protected isInitialized() {
    return this.featureIndex.length > 0;
  }

  /**
   * Test the first element in the feature array.  Its index should match
   * its frame number.  Otherwise, the constructor was called with a
   * dense array, which is incorrect.
   */
  private static sanityCheckFeatures(features: Feature[]) {
    const breakException = Symbol('breakException');
    try {
      features.forEach((f, i) => {
        if (f.frame !== i) {
          throw new Error(
            'features must be initialized with sparse array.'
            + 'Use Track.fromJson() if you want to initialize with features.',
          );
        }
        throw breakException;
      });
    } catch (e) {
      if (e !== breakException) throw e;
    }
  }

  private repopulateInterpolatedFrames(features: Feature[]) {
    this.featureIndex = [];
    features.forEach((f) => {
      // TODO: Figure out what the conditions are for this.
      if (f.keyframe && f.bounds) {
        this.featureIndex.push(f.frame);
      }
      if (!!f.keyframe !== !!f.bounds) {
        throw new Error('keyframe must not XOR bounds');
      }
    });
  }

  /* Call if the bounds were possible shrunk */
  private maybeShrinkBounds(frame: number) {
    const oldval = [this.begin, this.end];
    if (frame === this.begin) {
      // frame is begin
      const nextFrame = this.getNextKeyframe(this.begin + 1);
      if (nextFrame === undefined) {
        this.begin = Infinity;
        this.end = 0;
      } else {
        this.begin = nextFrame;
      }
      this.notify('bounds', oldval);
    } else if (frame === this.end) {
      // frame is end
      const previousFrame = this.getPreviousKeyframe(this.end - 1);
      if (previousFrame === undefined) {
        this.end = 0;
        this.begin = Infinity;
      } else {
        this.end = previousFrame;
      }
      this.notify('bounds', oldval);
    }
  }

  /** Determine if track can be split at frame */
  canSplit(frame: number) {
    return frame > this.begin && frame <= this.end;
  }

  /** Determine if a hypothetical feature at frame should enable interpolation */
  canInterpolate(frame: number): {
    features: InterpolateFeatures;
    interpolate: boolean;
  } {
    const [real, lower, upper] = this.getFeature(frame);
    return {
      features: [real, lower, upper],
      interpolate: real?.interpolate
        || (lower?.interpolate)
        || (!lower && (upper?.interpolate || false)),
    };
  }

  /**
   * Split trackId in two at given frame, where frame is allocated
   * to the second track.  Both tracks must end up with at least 1 detection.
   */
  split(frame: number, id1: AnnotationId, id2: AnnotationId): [Track, Track] {
    if (!this.canSplit(frame)) {
      throw new Error(`Cannot split track ${this.id} at frame ${frame}.  Frame bounds are [${this.begin}, ${this.end}]`);
    }
    return [
      Track.fromJSON({
        id: id1,
        meta: this.meta,
        begin: this.begin,
        end: this.getPreviousKeyframe(frame - 1) || this.begin,
        features: this.features.slice(this.begin, frame),
        confidencePairs: this.confidencePairs,
        attributes: this.attributes,
      }),
      Track.fromJSON({
        id: id2,
        meta: this.meta,
        begin: this.getNextKeyframe(frame) || this.end,
        end: this.end,
        features: this.features.slice(frame),
        confidencePairs: this.confidencePairs,
        attributes: this.attributes,
      }),
    ];
  }

  /**
   * Merge other into track at frame, preferring features from
   * self if there are conflicts
   */
  merge(others: Track[], disableNotifier = false) {
    if (disableNotifier) {
      this.notifierEnabled = false;
    }
    others.forEach((other) => {
      other.confidencePairs.forEach((pair) => {
        const match = this.confidencePairs.find(([name]) => name === pair[0]);
        // Only set confidence if greater
        if (match === undefined || match[1] < pair[1]) {
          this.setType(...pair);
        }
      });
      other.features.forEach((f) => {
        if (this.getFeature(f.frame)[0] === null) {
          this.setFeature(f, f.geometry?.features);
        }
      });
      const { attributes } = other;
      if (attributes !== undefined) {
        Object.entries(attributes).forEach(([key, val]) => {
          if (([null, undefined] as unknown[]).indexOf(this.attributes[key]) !== -1) {
            this.setAttribute(key, val);
          }
        });
      }
    });
    if (disableNotifier) {
      this.notifierEnabled = true;
    }
  }

  toggleKeyframe(frame: number) {
    const { features } = this.canInterpolate(frame);
    const [real, lower, upper] = features;
    if (real && this.length === 1) {
      throw new Error(`This is the only keyframe in Track:${this.trackId} it cannot be removed`);
    }
    if (real && !real.keyframe) {
      this.setFeature({
        ...real,
        frame,
        keyframe: true,
      });
    } else if ((lower || upper) && !real?.keyframe) {
      let interFeature: Feature | null = null;
      if (upper && frame > upper.frame) {
        interFeature = upper;
      } else if (lower && frame < lower.frame) {
        interFeature = lower;
      }
      if (interFeature) {
        this.setFeature({
          ...interFeature,
          frame,
          keyframe: true,
        });
      }
    } else if (real?.keyframe) {
      this.deleteFeature(frame);
    }
  }

  toggleInterpolation(frame: number) {
    const { features, interpolate } = this.canInterpolate(frame);
    const [real, lower, upper] = features;
    const targetKeyframe = real?.keyframe ? real : (lower || upper);
    if (targetKeyframe) {
      this.setFeature({
        ...targetKeyframe,
        interpolate: !interpolate,
      });
    }
  }

  setFeature(feature: Feature, geometry: GeoJSON.Feature<TrackSupportedFeature>[] = []): Feature {
    const f = this.features[feature.frame] || {};
    this.features[feature.frame] = {
      ...f,
      ...feature,
    };
    // round bounds if necessary
    if (feature.bounds) {
      this.features[feature.frame].bounds = [
        Math.round(feature.bounds[0]),
        Math.round(feature.bounds[1]),
        Math.round(feature.bounds[2]),
        Math.round(feature.bounds[3]),
      ];
    }
    if (!this.features[feature.frame].keyframe) {
      throw new Error('setFeature must be called with keyframe=true OR to update an existing keyframe');
    }
    listInsert(this.featureIndex, feature.frame);
    const fg = this.features[feature.frame].geometry || { type: 'FeatureCollection', features: [] };
    geometry.forEach((geo) => {
      const i = fg.features
        .findIndex((item) => {
          const keyMatch = !geo.properties?.key || item.properties?.key === geo.properties?.key;
          const typeMatch = item.geometry.type === geo.geometry.type;
          return keyMatch && typeMatch;
        });
      if (i >= 0) {
        fg.features.splice(i, 1, geo);
      } else {
        fg.features.push(geo);
      }
    });
    if (fg.features.length) {
      this.features[feature.frame].geometry = fg;
    }
    this.maybeExpandBounds(feature.frame);
    if (this.featureIndex.length === 1) {
      /**
       * If this is the very first feature, it may be necessary
       * to shrink the bounds if the first feature was added on a different frame
       * than the track was created on
       */
      if (feature.frame !== this.begin) {
        this.maybeShrinkBounds(this.begin);
      } else if (feature.frame !== this.end) {
        this.maybeShrinkBounds(this.end);
      }
    }
    this.notify('feature', f);
    return this.features[feature.frame];
  }

  /* Get features by properties.key, geometry.type, or both */
  getFeatureGeometry(frame: number, { key, type }:
    { key?: string; type?: GeoJSON.GeoJsonGeometryTypes | '' | 'rectangle' }) {
    const feature = this.features[frame];
    if (!feature || !feature.geometry) {
      return [];
    }
    return feature.geometry.features.filter((item) => {
      const matchesKey = !key || item.properties?.key === key;
      const matchesType = !type || item.geometry.type === type;
      return matchesKey && matchesType;
    });
  }

  removeFeatureGeometry(frame: number, { key, type }:
    { key?: string; type?: GeoJSON.GeoJsonGeometryTypes | '' | 'rectangle' }) {
    const feature = this.features[frame];
    if (!feature.geometry) {
      return false;
    }
    const index = feature.geometry.features.findIndex((item) => {
      const matchesKey = !key || item.properties?.key === key;
      const matchesType = !type || item.geometry.type === type;
      return matchesKey && matchesType;
    });
    if (index !== -1) {
      feature.geometry.features.splice(index, 1);
      this.notify('feature', feature);
      return true;
    }
    return false;
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

  /**
   * Returns a 3-tuple of nullable features:
   * [exact_feature_match, previous_keyframe, next_keyframe]
   */
  getFeature(frame: number): [Feature | null, Feature | null, Feature | null] {
    // First, try a direct keyframe hit
    const maybeFrame = this.features[frame];
    if (maybeFrame) {
      return [maybeFrame, maybeFrame, maybeFrame];
    }
    // Then see if we are outside the track bounds
    if (frame < this.begin || frame > this.end) {
      if (frame <= this.begin) {
        return [null, this.features[this.begin], null];
      }
      return [null, null, this.features[this.end]];
    }
    // Then try to interpolate
    const position = binarySearch(this.featureIndex, frame);
    const maybeInterpolated = getSurroundingElements(this.featureIndex, position);

    if (maybeInterpolated !== null) {
      const [d0, d1] = maybeInterpolated.map((_frame) => this.features[_frame]);
      return [Track.interpolate(frame, d0, d1), d0, d1];
    }

    if (this.featureIndex.length !== 0) {
      throw new Error(`Unexpected condition: Track bounds mis-aligned with feature array.
        begin=${this.begin}
        end=${this.end}
        firstFeature=${this.featureIndex[0]}
      `);
    }
    // Should only reach here when there are no features (empty)
    return [null, null, null];
  }

  /* Given a frame number, find the track's next keyframe */
  getNextKeyframe(frame: number): number | undefined {
    const next = this.features.slice(frame).find((a) => a);
    return next?.frame;
  }

  /* Given a frame number, find the track's previous keyframe */
  getPreviousKeyframe(frame: number): number | undefined {
    const previous = this.features.slice(0, frame + 1).reverse().find((a) => a);
    return previous?.frame;
  }

  deleteFeature(frame: number) {
    const feature = this.features[frame];
    if (feature && feature.keyframe) {
      listRemove(this.featureIndex, frame);
    }
    delete this.features[frame];
    this.maybeShrinkBounds(frame);
    this.notify('feature', feature);
  }

  /* Condense the sparse array to a dense one */
  condenseFeatures(): Feature[] {
    const features = [] as Feature[];
    this.features.forEach((f) => {
      features.push(f);
    });
    return features;
  }

  /* Serialize back to a regular track object */
  serialize(): TrackData {
    return {
      id: this.id,
      meta: this.meta,
      attributes: this.attributes,
      confidencePairs: this.confidencePairs,
      features: this.condenseFeatures(),
      begin: this.begin,
      end: this.end,
    };
  }

  /* Interpolate feature from d0 to d1 @ frame */
  static interpolate(frame: number, d0: Feature, d1: Feature): Feature | null {
    if (!d0.interpolate) {
      return null;
    }
    const len = d1.frame - d0.frame;
    // a + b = 1; interpolate from a to b
    const b = Math.abs((frame - d0.frame) / len);
    const a = 1 - b;
    let keyframe = false;
    if (b === 0 || a === 0) {
      keyframe = true; // actually this is a keyframe
    }
    let box;
    if (d0.bounds && d1.bounds) {
      const d0bounds = d0.bounds;
      const d1bounds = d1.bounds;
      box = d0bounds.map((_, i) => ((d0bounds[i] * a) + (d1bounds[i] * b)));
    } else {
      throw new Error('Bounds cannot be missing from interpolated features');
    }
    return {
      frame,
      bounds: [box[0], box[1], box[2], box[3]],
      interpolate: true,
      keyframe,
    };
  }

  static fromJSON(json: TrackData): Track {
    const sparseFeatures: Array<Feature> = [];
    json.features.forEach((f) => {
      sparseFeatures[f.frame] = {
        keyframe: true,
        ...f,
      };
    });
    // accept either number or string, convert to number
    const intTrackId = parseInt(json.id.toString(), 10);
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
