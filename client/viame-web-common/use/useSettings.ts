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

export interface TypeSettings {
  viewUnused: boolean;
  lockTypes: boolean;
}

export default function useSettings(allTypes: Ref<Readonly<string[]>>) {
  const clientSettings = reactive({
    newTrackSettings: {
      mode: 'Track' as 'Track' | 'Detection',
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
    typeSettings: {
      viewUnUsed: false,
      lockTypes: false,
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

  function updateTypeSettings(updatedTypeSettings: TypeSettings) {
    clientSettings.typeSettings = merge(
      clientSettings.typeSettings, updatedTypeSettings,
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
    updateTypeSettings(defaultSettings.typeSettings);
  }

  return { clientSettings: toRefs(clientSettings), updateNewTrackSettings, updateTypeSettings };
}
