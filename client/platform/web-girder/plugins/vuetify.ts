import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import colors from 'vuetify/lib/util/colors';
import { merge } from 'lodash';

import '@mdi/font/css/materialdesignicons.css';

Vue.use(Vuetify);

function getVuetify(config: unknown = {}) {
  const appVuetifyConfig = merge({
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
  }, config);
  return new Vuetify(appVuetifyConfig);
}

export default getVuetify;
