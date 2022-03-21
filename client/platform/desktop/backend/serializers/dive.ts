import { AnnotationSchema, MultiTrackRecord } from 'dive-common/apispec';
import { has } from 'lodash';
import { AnnotationsCurrentVersion } from 'platform/desktop/constants';
import { TrackData, TrackId } from 'vue-media-annotator/track';

function makeEmptyAnnotationFile(): AnnotationSchema {
  return {
    version: AnnotationsCurrentVersion,
    tracks: {},
    groups: {},
  };
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
      return annotations;
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

export {
  makeEmptyAnnotationFile,
  migrate,
};
