import { createVuetify } from 'vuetify';
import colors from 'vuetify/lib/util/colors';
import { merge } from 'lodash';
import girderVuetifyConfig from '@girder/components/plugins/vuetifyConfig.js';

import '@mdi/font/css/materialdesignicons.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import 'vuetify/styles';

import buildMaterialPaletteColors from './paletteColors';

const paletteColors = buildMaterialPaletteColors();

const variationColors = [
  'primary',
  'secondary',
  'accent',
  'error',
  'success',
  'warning',
  'grey',
  'blue-grey',
  'yellow',
  'light-blue',
];

const diveVuetifyDefaults = {
  defaults: {
    // Vuetify 2 default icon size was 24px; V3 uses em-based sizing that varies by context.
    VIcon: {
      size: 24,
    },
  },
};

const diveThemeOverrides = {
  theme: {
    defaultTheme: 'dark',
    variations: {
      colors: variationColors,
      lighten: 5,
      darken: 5,
    },
    themes: {
      light: {
        dark: false,
        colors: {
          ...paletteColors,
          accent: colors.blue.lighten1,
          secondary: colors.grey.darken1,
          primary: colors.blue.darken2,
          neutral: colors.grey.lighten5,
        },
      },
      dark: {
        dark: true,
        colors: {
          ...paletteColors,
          accent: colors.blue.lighten1,
          accentBackground: '#2c7596',
          grey: colors.grey.base,
          'blue-grey': colors.blueGrey.base,
        },
      },
    },
  },
};

export default function createDiveVuetify(
  customConfig: Record<string, unknown> | null | undefined = undefined,
) {
  return createVuetify(merge(
    {},
    girderVuetifyConfig,
    diveVuetifyDefaults,
    diveThemeOverrides,
    customConfig ?? {},
  ));
}
