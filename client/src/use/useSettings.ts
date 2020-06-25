import {
  reactive, ref,
} from '@vue/composition-api';

export interface NewTrackSettings {
    mode: string;
    type: string;
    modeSettings: {
      Track: {
        autoAdvanceFrame: boolean;
      };
      Detection: {
        continuous: boolean;
      };
    };
  }
export interface ClientSettings {
  NewTrackSettings: NewTrackSettings;
}

export default function useSettings() {
  const clientSettings = reactive({
    newTrackSettings: {
      mode: ref('Track'),
      type: ref('unknown'),
      modeSettings: {
        Track: {
          autoAdvanceFrame: ref(false),
        },
        Detection: {
          continuous: ref(true),
        },
      },
    },
  });

  function saveSettings() {
    localStorage.setItem('Settings', JSON.stringify(clientSettings));
  }

  function updateNewTrackSettings(updatedNewTrackSettings: NewTrackSettings) {
    const { newTrackSettings } = clientSettings;
    newTrackSettings.mode = updatedNewTrackSettings.mode;
    newTrackSettings.type = updatedNewTrackSettings.type;
    // eslint-disable-next-line max-len
    newTrackSettings.modeSettings.Track.autoAdvanceFrame = updatedNewTrackSettings.modeSettings.Track.autoAdvanceFrame;
    // eslint-disable-next-line max-len
    newTrackSettings.modeSettings.Detection.continuous = updatedNewTrackSettings.modeSettings.Detection.continuous;

    //Handle Saving of the data
    saveSettings();
  }

  //Load default settings initially
  const storedSettings = localStorage.getItem('Settings');
  if (storedSettings) {
    const defaultSettings = JSON.parse(storedSettings);
    updateNewTrackSettings(defaultSettings.newTrackSettings);
  }


  return { clientSettings, updateNewTrackSettings };
}
