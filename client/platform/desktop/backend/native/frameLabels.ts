/**
 * Frame label presets for imported datasets.
 *
 * A preset names the dataset's frame label set (shown as hotkeys by the
 * annotator's frame label mode).  One label may additionally be marked as the
 * default: it seeds a single full-frame interval track covering the whole
 * dataset, ready for review and correction in the annotator.
 */
import npath from 'path';

import type { TrackData } from 'vue-media-annotator/track';
import type { RectBounds } from 'vue-media-annotator/utils';

import { Settings } from 'platform/desktop/constants';
import { checkMedia } from './mediaJobs';
import * as common from './common';

export interface FrameLabelPresets {
  /** All label names, in the order given (hotkey order). */
  labels: string[];
  /** Label applied to the entire dataset on import, if any. */
  defaultLabel?: string;
}

/** Validate label names and the optional whole-dataset default. */
export function parseFrameLabelPresets(
  specs: string[],
  defaultLabel?: string,
): FrameLabelPresets {
  const labels: string[] = [];
  specs.forEach((spec) => {
    const label = spec.trim();
    if (!label) {
      throw new Error('Frame label names may not be empty');
    }
    if (labels.includes(label)) {
      throw new Error(`Duplicate frame label: "${label}"`);
    }
    labels.push(label);
  });
  if (defaultLabel !== undefined) {
    if (!labels.includes(defaultLabel)) {
      throw new Error(
        `Default frame label "${defaultLabel}" is not one of the given labels`,
      );
    }
  }
  return { labels, defaultLabel };
}

/** A single full-frame interval track covering every frame. */
export function buildDefaultLabelTrack(
  label: string,
  frameCount: number,
  bounds: RectBounds,
  trackId = 0,
): TrackData {
  const end = Math.max(0, frameCount - 1);
  const features = [{
    frame: 0,
    bounds,
    keyframe: true,
    interpolate: true,
  }];
  if (end > 0) {
    features.push({
      frame: end,
      bounds,
      keyframe: true,
      interpolate: true,
    });
  }
  return {
    id: trackId,
    meta: {},
    attributes: {},
    confidencePairs: [[label, 1]] as [string, number][],
    features,
    begin: 0,
    end,
  };
}

/**
 * Apply frame label presets to a dataset: record the label set on its
 * metadata and, when a default label is given, cover the whole dataset with
 * one full-frame track of that label.
 */
export async function applyFrameLabelPresets(
  settings: Settings,
  datasetId: string,
  presets: FrameLabelPresets,
): Promise<void> {
  if (presets.labels.length === 0) {
    return;
  }
  const projectInfo = await common.getValidatedProjectDir(settings, datasetId);
  const meta = await common.loadJsonConfig(projectInfo.datasetFileAbsPath);

  await common.saveConfig(settings, datasetId, { frameLabels: presets.labels });

  if (!presets.defaultLabel) {
    return;
  }
  let frameCount: number;
  let bounds: RectBounds;
  if (meta.type === 'video') {
    const media = await checkMedia(
      npath.join(meta.originalBasePath, meta.originalVideoFile),
    );
    if (!media.videoDuration) {
      throw new Error(`Could not determine duration of ${meta.originalVideoFile}`);
    }
    frameCount = Math.max(1, Math.floor(media.videoDuration * meta.fps));
    bounds = [0, 0, media.videoDimensions.width, media.videoDimensions.height];
  } else if (meta.type === 'image-sequence') {
    frameCount = meta.originalImageFiles.length;
    const media = await checkMedia(
      npath.join(meta.originalBasePath, meta.originalImageFiles[0]),
    );
    bounds = [0, 0, media.videoDimensions.width, media.videoDimensions.height];
  } else {
    throw new Error(`Default frame labels are not supported for ${meta.type} datasets`);
  }

  const existing = await common.loadAnnotationFile(projectInfo.trackFileAbsPath);
  const trackId = Object.keys(existing.tracks)
    .reduce((high, id) => Math.max(high, Number.parseInt(id, 10) + 1), 0);

  await common.saveDetections(settings, datasetId, {
    tracks: {
      upsert: [buildDefaultLabelTrack(presets.defaultLabel, frameCount, bounds, trackId)],
      delete: [],
    },
    groups: { upsert: [], delete: [] },
  });
}
