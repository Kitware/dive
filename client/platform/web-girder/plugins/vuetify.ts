import { createVuetify } from 'vuetify';
import colors from 'vuetify/util/colors';
import { merge } from 'lodash';

import girderVuetifyConfig from '@girder/components/plugins/vuetifyConfig.js';

export type BrandVuetifyConfig = Record<string, unknown>;

function buildThemeOverrides() {
  return {
    dark: true,
    themes: {
      dark: {
        colors: {
          accent: colors.blue.lighten1,
          accentBackground: '#2c7596',
        },
      },
    },
  };
}

export function createDiveVuetify(brandConfig?: BrandVuetifyConfig) {
  const appVuetifyConfig = merge(
    {},
    girderVuetifyConfig,
    brandConfig,
    { theme: buildThemeOverrides() },
  );
  return createVuetify(appVuetifyConfig);
}

export default createDiveVuetify;
