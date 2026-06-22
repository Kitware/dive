import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import * as components from 'vuetify/lib/components';
import * as directives from 'vuetify/lib/directives';
import colors from 'vuetify/es5/util/colors';
import { vuetifyConfig as girderVuetifyConfig } from '@girder/components/src';
import { merge } from 'lodash';

import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';

// vuetify/lib is the à la carte build (chosen to avoid a duplicate Vue copy from
// the full dist). With no vuetify-loader configured, components/directives must
// be registered explicitly or none are available (Unknown custom element: <v-app>).
Vue.use(Vuetify, { components, directives });

const appVuetifyConfig = merge(girderVuetifyConfig, {
  theme: {
    dark: true,
    options: {
      customProperties: true,
    },
    themes: {
      light: {
        accent: colors.blue.lighten1,
        secondary: colors.grey.darken1,
        primary: colors.blue.darken2,
        neutral: colors.grey.lighten5,
      },
      dark: {
        accent: colors.blue.lighten1,
        accentBackground: '#2c7596',
      },
    },
  },
});

export default new Vuetify(appVuetifyConfig);
