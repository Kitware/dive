import { merge } from 'lodash';
import {
  reactive, toRefs,
} from '@vue/composition-api';

export interface NewTrackSettings {
    mode: string;
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
export interface ClientSettings {
  newTrackSettings: NewTrackSettings;
}

export default function useSettings() {
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
  } as ClientSettings);

  function saveSettings() {
    localStorage.setItem('Settings', JSON.stringify(clientSettings));
  }

  function updateNewTrackSettings(updatedNewTrackSettings: NewTrackSettings) {
    clientSettings.newTrackSettings = merge(
      clientSettings.newTrackSettings, updatedNewTrackSettings,
    );
    saveSettings();
  }

  //Load default settings initially
  const storedSettings = localStorage.getItem('Settings');
  if (storedSettings) {
    const defaultSettings = JSON.parse(storedSettings);
    updateNewTrackSettings(defaultSettings.newTrackSettings);
  }

  return { clientSettings: toRefs(clientSettings), updateNewTrackSettings };
}
