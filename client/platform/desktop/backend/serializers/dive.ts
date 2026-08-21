import { AnnotationSchema, MultiTrackRecord } from 'dive-common/apispec';
import { has } from 'lodash';
import { AnnotationsCurrentVersion, JsonConfig } from 'platform/desktop/constants';
import Track, { TrackData, TrackId } from 'vue-media-annotator/track';
import fs from 'fs-extra';

function makeEmptyAnnotationFile(): AnnotationSchema {
  return {
    version: AnnotationsCurrentVersion,
    tracks: {},
    groups: {},
  };
}

/**
 * Annotation FPS recorded on a DIVE JSON document, if usable.
 * Same rules as the VIAME CSV `fps:` header and COCO `videos[].fps`.
 */
function frameRateFromDocument(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const rate = (data as { fps?: unknown }).fps;
  if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
    return rate;
  }
  return undefined;
}

/**
 * Take a JSON file and migrate it to the latest revision
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(jsonData: any): AnnotationSchema {
  if (Array.isArray(jsonData)) {
    throw new Error('object expected in track json');
  }
  if (has(jsonData, 'version')) {
    const annotations = jsonData as AnnotationSchema;
    if (annotations.version === AnnotationsCurrentVersion) {
      const migrated: AnnotationSchema = {
        version: AnnotationsCurrentVersion,
        tracks: annotations.tracks,
        groups: annotations.groups || {},
      };
      const fps = frameRateFromDocument(annotations);
      if (fps !== undefined) {
        migrated.fps = fps;
      }
      return migrated;
    }
    throw new Error(`Unexpected version number ${jsonData.version}`);
  } else {
    Object.values(jsonData as Record<string, TrackData & { trackId?: TrackId }>).forEach((t) => {
      // eslint-disable-next-line
      t.id = t.trackId!!;
      // eslint-disable-next-line no-param-reassign
      delete t.trackId;
    });
    return {
      tracks: jsonData as MultiTrackRecord,
      groups: {},
      version: AnnotationsCurrentVersion,
    };
  }
}

function filterTracks(
  data: AnnotationSchema,
  meta: JsonConfig,
  typeFilter = new Set<string>(),
  options = {
    excludeBelowThreshold: false,
    header: true,
  },
): AnnotationSchema {
  const filters = meta.confidenceFilters || {};
  const updatedFilteredTracks: Record<number, TrackData> = {};
  Object.values(data.tracks).forEach((track) => {
    /* Include only the pairs that exceed the threshold in JSON output */
    const confidencePairs = options.excludeBelowThreshold
      ? Track.exceedsThreshold(track.confidencePairs, filters)
      : track.confidencePairs;
    const filteredPairs = typeFilter.size > 0
      ? confidencePairs.filter((x) => typeFilter.has(x[0]))
      : confidencePairs;
    if (!filteredPairs.length) {
      return;
    }
    if (options.excludeBelowThreshold || typeFilter.size > 0) {
      // Filters select raw stored evidence. Copy before pruning so an export
      // never mutates the stored track or leaks removed pairs into its output.
      updatedFilteredTracks[track.id] = {
        ...track,
        confidencePairs: filteredPairs.map(([name, score]) => [name, score]),
      };
    } else {
      updatedFilteredTracks[track.id] = track;
    }
  });
  return {
    version: data.version,
    tracks: updatedFilteredTracks,
    groups: data.groups,
  };
}

async function serializeFile(
  path: string,
  data: AnnotationSchema,
  meta: JsonConfig,
  typeFilter = new Set<string>(),
  options = {
    excludeBelowThreshold: false,
    header: true,
  },
) {
  const updatedData = filterTracks(data, meta, typeFilter, options);
  // Dataset annotation FPS rides on the document the same way CSV/COCO carry it.
  const fps = (
    typeof meta.fps === 'number'
    && Number.isFinite(meta.fps)
    && meta.fps > 0
  ) ? meta.fps : undefined;
  const output: AnnotationSchema = fps !== undefined
    ? { ...updatedData, fps }
    : updatedData;
  const jsonData = JSON.stringify(output, null, 2);
  await fs.writeFile(path, jsonData, 'utf8');
}

export {
  makeEmptyAnnotationFile,
  frameRateFromDocument,
  migrate,
  filterTracks,
  serializeFile,
};
