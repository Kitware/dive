import { cloneDeep } from 'lodash';

import type { Feature, InterpolateFeatures } from './track';
import Track from './track';
import type {
  AnnotationId, ConfidencePair, StringKeyObject,
} from './BaseAnnotation';

export interface TrackProjection {
  readonly id: AnnotationId;
  readonly trackId: AnnotationId;
  readonly meta?: Readonly<StringKeyObject>;
  readonly attributes: Readonly<StringKeyObject & { userAttributes?: StringKeyObject }>;
  readonly confidencePairs: readonly Readonly<ConfidencePair>[];
  readonly begin: number;
  readonly end: number;
  readonly length: number;
  readonly features: readonly (Readonly<Feature> | undefined)[];
  readonly featureIndex: readonly number[];
  readonly set?: string;
  getType(index?: number): Readonly<ConfidencePair>;
  getFeature(frame: number): readonly [Feature | null, Feature | null, Feature | null];
  canInterpolate(frame: number): {
    features: InterpolateFeatures;
    interpolate: boolean;
  };
  getNextKeyframe(frame: number): number | undefined;
  getPreviousKeyframe(frame: number): number | undefined;
}

function clonedFeatureResult(
  result: readonly [Feature | null, Feature | null, Feature | null],
): [Feature | null, Feature | null, Feature | null] {
  const [real, lower, upper] = result;
  if (real !== null && real === lower && real === upper) {
    const copy = cloneDeep(real) as Feature;
    return [copy, copy, copy];
  }
  const copies = result.map((feature) => (feature === null ? null : cloneDeep(feature) as Feature));
  return copies as [Feature | null, Feature | null, Feature | null];
}

export function createTrackProjection(tracks: readonly Track[]): TrackProjection {
  const first = tracks[0];
  if (!first) {
    throw new Error('Cannot project an empty logical track');
  }

  const features: (Feature | undefined)[] = [];
  const confidenceByType = new Map<string, number>();
  const attributes = cloneDeep(first.attributes);
  tracks.forEach((track) => {
    track.confidencePairs.forEach(([type, confidence]) => {
      const current = confidenceByType.get(type);
      if (current === undefined || confidence > current) {
        confidenceByType.set(type, confidence);
      }
    });
    track.features.forEach((feature) => {
      if (features[feature.frame] === undefined) {
        features[feature.frame] = cloneDeep(feature);
      }
    });
    Object.entries(track.attributes).forEach(([key, value]) => {
      if (attributes[key] === null || attributes[key] === undefined) {
        attributes[key] = cloneDeep(value);
      }
    });
  });
  const featureIndex = features
    .flatMap((feature) => (feature?.keyframe && feature.bounds ? [feature.frame] : []));
  const begin = Math.min(...tracks.map((track) => track.begin));
  const end = Math.max(...tracks.map((track) => track.end));
  const confidencePairs = Array.from(confidenceByType.entries()) as ConfidencePair[];

  const projection: TrackProjection = {
    id: first.id,
    trackId: first.id,
    meta: cloneDeep(first.meta),
    attributes,
    confidencePairs,
    begin,
    end,
    length: (end - begin) + 1,
    features,
    featureIndex,
    set: first.set,
    getType(index = 0) {
      const pair = confidencePairs[index];
      if (!pair) {
        throw new Error('Index Error: The requested confidencePairs index does not exist.');
      }
      return pair;
    },
    getFeature(frame) {
      return clonedFeatureResult(Track.getFeatureFrom(features, featureIndex, begin, end, frame));
    },
    canInterpolate(frame) {
      const result = clonedFeatureResult(
        Track.getFeatureFrom(features, featureIndex, begin, end, frame),
      );
      const [real, lower, upper] = result;
      return {
        features: result,
        interpolate: real?.interpolate
          || lower?.interpolate
          || (!lower && (upper?.interpolate || false)),
      };
    },
    getNextKeyframe(frame) {
      return features.slice(frame).find((feature) => feature)?.frame;
    },
    getPreviousKeyframe(frame) {
      return features.slice(0, frame + 1).reverse().find((feature) => feature)?.frame;
    },
  };
  return projection;
}
