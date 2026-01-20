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
  };
  multiCamSettings: {
    showToolbar: boolean;
  };
  layoutSettings: {
    sidebarPosition: 'left' | 'bottom';
  };
  stereoSettings: {
    interactiveModeEnabled: boolean;
    /** Loading state - not persisted, set by ViewerLoader */
    loading: boolean;
    /** Loading message to display */
    loadingMessage: string;
  };
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
    lockedCamera: {
      enabled: false,
      multiBounds: false,
      transition: false,
    },
  },
  timelineCountSettings: {
    totalCount: true,
    defaultView: 'tracks',
  },
  multiCamSettings: {
    showToolbar: true,
  },
  layoutSettings: {
    sidebarPosition: 'left',
  },
  stereoSettings: {
    interactiveModeEnabled: false,
    loading: false,
    loadingMessage: '',
  },
};

// Utility to safely load from localStorage
function loadStoredSettings(): Partial<AnnotationSettings> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('Settings');
      return raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    console.warn('Failed to load settings from localStorage:', e);
  }
  return {};
}

// Utility to safely save to localStorage
// Note: stereoSettings is excluded from persistence as it should reset each session
function saveSettings() {
  try {
    if (typeof localStorage !== 'undefined') {
      // Clone settings and exclude stereoSettings from persistence
      const settingsToSave = {
        ...clientSettings,
        stereoSettings: {
          // Only persist non-transient settings (none currently)
          interactiveModeEnabled: false, // Always false on reload
          loading: false,
          loadingMessage: '',
        },
      };
      localStorage.setItem('Settings', JSON.stringify(settingsToSave));
    }
  } catch (e) {
    console.warn('Failed to save settings to localStorage:', e);
  }
}

function hydrate(obj: Partial<AnnotationSettings>): AnnotationSettings {
  return merge(cloneDeep(defaultSettings), obj);
}

const clientSettings = reactive(hydrate(loadStoredSettings()));

export default function setup(allTypes: Ref<Readonly<string[]>>) {
  // If a type is deleted, reset the default new track type to unknown
  watch(allTypes, (newval) => {
    if (newval.indexOf(clientSettings.trackSettings.newTrackSettings.type) === -1) {
      clientSettings.trackSettings.newTrackSettings.type = 'unknown';
    }
  });
}
watch(clientSettings, saveSettings, { deep: true });

export {
  clientSettings,
  AnnotationSettings,
};
