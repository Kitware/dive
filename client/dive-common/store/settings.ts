import { Ref, watch, reactive } from 'vue';
import { cloneDeep, merge } from 'lodash';
import { AnnotatorPreferences } from 'vue-media-annotator/types';
import isDesktopRuntime from 'dive-common/isDesktopRuntime';

interface ColumnVisibilitySettings {
  type: boolean;
  confidence: boolean;
  startFrame: boolean;
  endFrame: boolean;
  startTimestamp: boolean;
  endTimestamp: boolean;
  notes: boolean;
  attributeColumns: string[]; // Array of attribute keys to show as columns
}

interface AnnotationSettings {
  typeSettings: {
    trackSortDir: 'a-z' | 'count' | 'frame count';
    showEmptyTypes: boolean;
    lockTypes: boolean;
    preventCascadeTypes?: boolean;
    filterTypesByFrame?: boolean;
    maxCountButton?: boolean;
    // Region of this type: detections whose geometry lies at least
    // suppressionThreshold percent under it are hidden and excluded from
    // counts. Attribute of this name set true: detection stays visible with
    // its real type (optional dashed/fill styling and eye-off tag) and is
    // excluded from its own type's counts. Empty string disables both.
    suppressionType?: string;
    // Minimum covered percent (0-100] for region suppression;
    // out-of-range values fall back to the default (99).
    suppressionThreshold?: number;
    // Where per-type/track/group color and style overrides are stored.
    // 'shared': one set of colors is reused across every dataset (per user on
    // web, across all sequences on desktop). 'dataset': colors are saved only
    // with the dataset they were set on (the original behavior).
    colorScope?: 'shared' | 'dataset';
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
      columnVisibility?: ColumnVisibilitySettings;
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
  autoSaveSettings: {
    enabled: boolean;
    delaySeconds: number;
  };
  stereoSettings: {
    // When importing a new camera file, optionally drop length measurements
    // computed against the previous calibration.
    clearLengthOnCameraFileLoad: boolean;
    // Recompute length attributes when a line's vertices are modified on a
    // detection that is linked across both cameras.
    updateLengthsOnModify: boolean;
    // Warp an annotation drawn on one camera to the other camera when that
    // camera has no detection for it yet.
    autoComputeOtherCamera: boolean;
    loading: boolean;
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
      columnVisibility: {
        type: true,
        confidence: true,
        startFrame: true,
        endFrame: true,
        startTimestamp: false,
        endTimestamp: false,
        notes: true,
        attributeColumns: [],
      },
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
    suppressionType: 'Suppressed',
    suppressionThreshold: 99,
    colorScope: 'shared',
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
    showUserCreatedIcon: false,
    showSuppressedTags: true,
    suppressionDisplay: {
      enabled: true,
      dashed: true,
      outlineOpacity: 1,
      fillColor: '',
      fillOpacity: 0.3,
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
  autoSaveSettings: {
    enabled: false, // Disabled by default for backward compatibility
    // Shorter default delay on desktop; web keeps the longer default to reduce server churn.
    delaySeconds: isDesktopRuntime() ? 15 : 60,
  },
  stereoSettings: {
    clearLengthOnCameraFileLoad: true,
    updateLengthsOnModify: true,
    autoComputeOtherCamera: false,
    loading: false,
    loadingMessage: '',
  },
};
const MIN_AUTO_SAVE_DELAY_SECONDS = 10;

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
function saveSettings() {
  try {
    if (typeof localStorage !== 'undefined') {
      // Exclude transient stereo fields from persistence
      const toSave = {
        ...clientSettings,
        stereoSettings: {
          ...clientSettings.stereoSettings,
          loading: false,
          loadingMessage: '',
        },
      };
      localStorage.setItem('Settings', JSON.stringify(toSave));
    }
  } catch (e) {
    console.warn('Failed to save settings to localStorage:', e);
  }
}

function hydrate(obj: Partial<AnnotationSettings>): AnnotationSettings {
  const hydrated = merge(cloneDeep(defaultSettings), obj);
  hydrated.autoSaveSettings.delaySeconds = Math.max(
    MIN_AUTO_SAVE_DELAY_SECONDS,
    Number(hydrated.autoSaveSettings.delaySeconds) || defaultSettings.autoSaveSettings.delaySeconds,
  );
  if (!isDesktopRuntime()) {
    hydrated.stereoSettings.updateLengthsOnModify = false;
    hydrated.stereoSettings.autoComputeOtherCamera = false;
  }
  return hydrated;
}

const clientSettings = reactive(hydrate(loadStoredSettings()));

/**
 * Interactive stereo requires the desktop VIAME interactive service. The
 * backend service is needed whenever either stereo feature (length update or
 * cross-camera auto-compute) is enabled.
 */
function isStereoInteractiveModeEnabled(): boolean {
  return isDesktopRuntime() && (
    clientSettings.stereoSettings.updateLengthsOnModify
    || clientSettings.stereoSettings.autoComputeOtherCamera
  );
}

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
  isStereoInteractiveModeEnabled,
  AnnotationSettings,
  ColumnVisibilitySettings,
};
