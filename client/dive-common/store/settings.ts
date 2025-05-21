import { Ref, watch, reactive } from 'vue';
import { cloneDeep, merge } from 'lodash';
import { AnnotatorPreferences } from 'vue-media-annotator/types';

interface AnnotationSettings {
  typeSettings: {
    trackSortDir: 'a-z' | 'count' | 'frame count';
    showEmptyTypes: boolean;
    lockTypes: boolean;
    preventCascadeTypes?: boolean;
    filterTypesByFrame?: boolean;
    maxCountButton?: boolean;
  };
  trackSettings: {
    newTrackSettings: {
      mode: 'Track' | 'Detection';
      type: string;
      modeSettings: {
        Track: {
          autoAdvanceFrame: boolean;
          interpolate: boolean;
        };
        Detection: {
          continuous: boolean;
        };
      };
    };
    deletionSettings: {
      promptUser: boolean;
    };
    trackListSettings: {
      autoZoom?: boolean;
      filterDetectionsByFrame?: boolean;
    }
  };
  groupSettings: {
    newGroupSettings: {
      type: string;
    };
  };
  rowsPerPage: number;
  annotationFPS: number;
  annotatorPreferences: AnnotatorPreferences;
  timelineCountSettings: {
    totalCount: boolean;
    defaultView: 'tracks' | 'detections';
  }
}

const defaultSettings: AnnotationSettings = {
  trackSettings: {
    newTrackSettings: {
      mode: 'Track' as 'Track' | 'Detection',
      type: 'unknown',
      modeSettings: {
        Track: {
          autoAdvanceFrame: false,
          interpolate: false,
        },
        Detection: {
          continuous: false,
        },
      },
    },
    deletionSettings: {
      promptUser: true,
    },
    trackListSettings: {
      autoZoom: false,
      filterDetectionsByFrame: false,
    },
  },
  groupSettings: {
    newGroupSettings: {
      type: 'unknown',
    },
  },
  typeSettings: {
    trackSortDir: 'a-z',
    showEmptyTypes: false,
    lockTypes: false,
    preventCascadeTypes: false,
    maxCountButton: false,
  },
  rowsPerPage: 20,
  annotationFPS: 10,
  annotatorPreferences: {
    trackTails: {
      before: 20,
      after: 10,
    },
  },
  timelineCountSettings: {
    totalCount: true,
    defaultView: 'tracks',
  },

};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrate(obj: any): AnnotationSettings {
  return merge(cloneDeep(defaultSettings), obj);
}

//Load default settings initially
const storedSettings = JSON.parse(localStorage.getItem('Settings') || '{}');
const clientSettings = reactive(hydrate(storedSettings));

function saveSettings() {
  localStorage.setItem('Settings', JSON.stringify(clientSettings));
}

export default function setup(allTypes: Ref<Readonly<string[]>>) {
  // If a type is deleted, reset the default new track type to unknown
  watch(allTypes, (newval) => {
    if (newval.indexOf(clientSettings.trackSettings.newTrackSettings.type) === -1) {
      clientSettings.trackSettings.newTrackSettings.type = 'unknown';
    }
  });
}
watch(clientSettings, saveSettings);

export {
  clientSettings,
  AnnotationSettings,
};
