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

//The idea is that we will have more settings in future.
export interface SettingsState {
    newTrackSettings: NewTrackSettings;
}

const Settings = {
  namespaced: true,
  state: {
    newTrackSettings: {
      mode: 'Track',
      type: 'unknown',
      modeSettings: {
        Track: {
          autoAdvanceFrame: false,
        },
        Detection: {
          continuous: true,
        },
      },
    } as NewTrackSettings,
  } as SettingsState,
  mutations: {
    setNewTrackSettings(state: SettingsState, newSettings: NewTrackSettings) {
      state.newTrackSettings = newSettings;
    },
  },
  getters: {
    getNewTrackSettings: (state: SettingsState) => state.newTrackSettings,
  },
};

export default Settings;
