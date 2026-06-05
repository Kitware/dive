import { createVuetify } from 'vuetify';
import colors from 'vuetify/util/colors';
import { merge } from 'lodash';

import girderVuetifyConfig from '@girder/components/plugins/vuetifyConfig.js';

const appVuetifyConfig = merge(girderVuetifyConfig, {
  theme: {
    dark: true,
    themes: {
      light: {
        colors: {
          accent: colors.blue.lighten1,
          secondary: colors.grey.darken1,
          primary: colors.blue.darken2,
          neutral: colors.grey.lighten5,
        },
      },
      dark: {
        colors: {
          accent: colors.blue.lighten1,
          accentBackground: '#2c7596',
        },
      },
    },
  },
});

export default createVuetify(appVuetifyConfig);
