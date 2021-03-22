import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import colors from 'vuetify/lib/util/colors';
import { merge } from 'lodash';

import '@mdi/font/css/materialdesignicons.css';
import { ThemeOptions } from 'vuetify/types/services/theme';
import { vuetifyConfig } from '@girder/components/src';

Vue.use(Vuetify);

function getVuetify(config: unknown) {
  const theme: ThemeOptions = {
    dark: true,
    options: {
      customProperties: true,
    },
    themes: {
      dark: {
        accent: colors.blue.lighten1,
        accentBackground: '#2c7596',
      },
    },
  };
  const appVuetifyConfig = merge(vuetifyConfig, config, { theme });
  return new Vuetify(appVuetifyConfig);
}

export default getVuetify;
