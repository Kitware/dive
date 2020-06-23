import { Module } from 'vuex';

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

const Settings: Module<SettingsState, never> = {
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
    },
  },
  mutations: {
    setNewTrackSettings(state, newSettings: NewTrackSettings) {
      state.newTrackSettings = newSettings;
    },
  },
  getters: {
    getNewTrackSettings: (state) => state.newTrackSettings,
  },
};

export default Settings;
