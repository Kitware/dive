import { merge } from 'lodash';
import {
  reactive, toRefs, Ref, watch,
} from '@vue/composition-api';

export interface NewTrackSettings {
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
}

export default function useSettings(allTypes: Ref<string[]>) {
  const clientSettings = reactive({
    newTrackSettings: {
      mode: 'Track',
      type: 'unknown',
      modeSettings: {
        Track: {
          autoAdvanceFrame: false,
          interpolate: false,
        },
        Detection: {
          continuous: true,
        },
      },
    },
  });

  function saveSettings() {
    localStorage.setItem('Settings', JSON.stringify(clientSettings));
  }

  function updateNewTrackSettings(updatedNewTrackSettings: NewTrackSettings) {
    clientSettings.newTrackSettings = merge(
      clientSettings.newTrackSettings, updatedNewTrackSettings,
    );
    saveSettings();
  }

  // If a type is deleted, reset the default new track type to unknown
  watch(allTypes, (newval) => {
    if (newval.indexOf(clientSettings.newTrackSettings.type) === -1) {
      clientSettings.newTrackSettings.type = 'unknown';
    }
  });

  //Load default settings initially
  const storedSettings = localStorage.getItem('Settings');
  if (storedSettings) {
    const defaultSettings = JSON.parse(storedSettings);
    updateNewTrackSettings(defaultSettings.newTrackSettings);
  }

  return { clientSettings: toRefs(clientSettings), updateNewTrackSettings };
}
