import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import colors from 'vuetify/lib/util/colors';
import girderVuetifyConfig from '@girder/components/src/utils/vuetifyConfig';
import { merge } from 'lodash';

import '@mdi/font/css/materialdesignicons.css';

Vue.use(Vuetify);

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
