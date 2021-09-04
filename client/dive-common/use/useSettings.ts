import {
  Ref, watch, reactive,
} from '@vue/composition-api';


export interface AnnotationSettings {
  typeSettings: {
    showEmptyTypes: boolean;
    lockTypes: boolean;
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
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAnnotationSettings(obj: any): obj is AnnotationSettings {
  return obj.trackSettings && obj.typeSettings;
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
  },
  typeSettings: {
    showEmptyTypes: false,
    lockTypes: false,
  },
};

export default function useSettings(allTypes: Ref<Readonly<string[]>>) {
  const clientSettings = reactive(defaultSettings);

  function saveSettings() {
    localStorage.setItem('Settings', JSON.stringify(clientSettings));
  }

  function updateSettings(updatedSettings: AnnotationSettings) {
    Object.assign(clientSettings, updatedSettings);
    saveSettings();
  }

  // If a type is deleted, reset the default new track type to unknown
  watch(allTypes, (newval) => {
    if (newval.indexOf(clientSettings.trackSettings.newTrackSettings.type) === -1) {
      clientSettings.trackSettings.newTrackSettings.type = 'unknown';
    }
  });

  //Load default settings initially
  const storedSettings = localStorage.getItem('Settings');
  if (storedSettings) {
    const userSettings = JSON.parse(storedSettings);
    if (isAnnotationSettings(userSettings)) {
      updateSettings(userSettings);
    }
  }
  return {
    clientSettings,
    updateSettings,
  };
}
