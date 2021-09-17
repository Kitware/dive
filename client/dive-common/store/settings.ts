import Install, { Ref, watch, reactive } from '@vue/composition-api';
import { cloneDeep, merge } from 'lodash';
import Vue from 'vue';

interface AnnotationSettings {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrate(obj: any): AnnotationSettings {
  return merge(cloneDeep(defaultSettings), obj);
}

// TODO remove this: this won't be necessary in Vue 3
Vue.use(Install);

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
  watch(clientSettings, saveSettings);
}

export {
  clientSettings,
  AnnotationSettings,
};
