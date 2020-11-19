import type Vuetify from 'vuetify';

import {
  inject, ref, Ref, computed, set as VueSet,
} from '@vue/composition-api';
import * as d3 from 'd3';
import { noop } from 'lodash';

interface Style {
  strokeWidth: number;
  opacity: number;
  color: string;
  fill: boolean;
}

export interface StateStyles {
  standard: Style;
  selected: Style;
  disabled: Style;
}

export interface CustomStyle {
  color?: string;
  strokeWidth?: number;
  opacity?: number;
  fill?: boolean;
}

export interface TypeStyling {
  color: (type: string) => string;
  strokeWidth: (type: string) => number;
  fill: (type: string) => boolean;
  opacity: (type: string) => number;
}

interface UseStylingParams {
  markChangesPending: () => void;
}

/**
   * Generates a color pallette as a list of hex colors.
   * It generates colors from a rainbow spectrum and then takes a dark and lighter version
   * of each color.
   * @param {int} numColors - number of colors to attempt to generate the higher
   * the number the more similar the colors will be.  Cyan like colors will be filtered out,
   * so numColors isn't a guarantee of x*3 (normal, dark, light) colors.
   */
function generateColors(numColors: number) {
  const colorList = [];
  for (let i = 0; i < numColors; i += 1) {
    //We are using a rainbow but we want to skip the cyan area so number will be reduced
    const pos = (i * (1 / numColors));
    if (pos > 0.58 && pos < 0.63) {
      break;
    }
    const baseColor = d3.color(d3.interpolateRainbow(pos))?.hex();
    if (baseColor) {
      const hueColor = d3.hsl(baseColor);
      hueColor.s = 1.0;
      hueColor.l = 0.5;
      colorList.push(hueColor.hex());
      hueColor.s = 0.5;
      hueColor.l = 0.35;
      colorList.push(hueColor.hex());
      hueColor.s = 1.0;
      hueColor.l = 0.75;
      colorList.push(hueColor.hex());
    }
  }

  //Mix up colors in a uniform way so reloads have the same types associated with the same colors
  let seed = 0.28;
  colorList.sort(() => {
    seed += seed;
    return Math.cos(seed);
  });
  return colorList;
}

export default function useStyling({ markChangesPending }: UseStylingParams) {
  const vuetify = inject('vuetify') as Vuetify;

  /**
   * Revision counter should be watched for re-rendering based on customStyles
   * because we're using geojs's styling functions, which will not be invoked until render,
   * so we can't use deep watching to trigger re-render (chicken and egg).
   */
  const customStylesRevisionCounter = ref(1);
  const customStyles = ref({} as Record<string, CustomStyle>);
  if (!vuetify) {
    throw new Error('Missing vuetify provide/inject');
  }
  // Annotation State Colors
  const standard: Style = {
    strokeWidth: 3,
    opacity: 1.0,
    color: 'type',
    fill: false,
  };
  const selected: Style = {
    ...standard,
    color: vuetify.preset.theme.themes.dark.accent as string,
    strokeWidth: 5,
    opacity: 1.0,
    fill: false,
  };
  const disabled: Style = {
    ...standard,
    color: 'type',
    strokeWidth: 1,
    opacity: 0.45,
    fill: false,
  };
  const stateStyling: StateStyles = { standard, selected, disabled };
  const typeColors = generateColors(10);

  function populateTypeStyles(styles?: Record<string, CustomStyle>) {
    if (styles) {
      customStyles.value = styles;
    }
  }

  function updateTypeStyle(args: {
    type: string;
    color?: string;
    strokeWidth?: number;
    opacity?: number;
    fill?: boolean;
  }) {
    const { type } = args;
    if (!customStyles.value[type]) {
      VueSet(customStyles.value, type, {});
    }
    Object.entries(args).forEach(([key, value]) => {
      if (value !== undefined) {
        VueSet(customStyles.value[type], key, value);
      }
    });
    customStylesRevisionCounter.value += 1;
    markChangesPending();
  }

  const ordinalColorMapper = d3.scaleOrdinal<string>().range(typeColors);

  const typeStyling = computed(() => {
    // establish dependency on revision counter
    if (customStylesRevisionCounter.value) noop();
    const _customStyles = customStyles.value;
    return {
      color: (type: string) => {
        if (_customStyles[type] && _customStyles[type].color) {
          return _customStyles[type].color;
        }
        if (type === '') {
          return ordinalColorMapper.range()[0];
        }
        return ordinalColorMapper(type);
      },
      strokeWidth: (type: string) => {
        if (_customStyles[type] && _customStyles[type].strokeWidth) {
          return _customStyles[type].strokeWidth;
        }
        return stateStyling.standard.strokeWidth;
      },
      fill: (type: string) => {
        if (_customStyles[type] && _customStyles[type].fill !== undefined) {
          return _customStyles[type].fill;
        }
        return stateStyling.standard.fill;
      },
      opacity: (type: string) => {
        if (_customStyles[type] && _customStyles[type].opacity) {
          return _customStyles[type].opacity;
        }
        return stateStyling.standard.opacity;
      },
    } as TypeStyling;
  });

  function getTypeStyles(allTypes: Ref<readonly string[]>) {
    //We need to remove any unused types in the colors, either deleted or changed
    //Also want to save default colors for reloading
    const savedTypeStyles = {} as Record<string, CustomStyle>;
    allTypes.value.forEach((name) => {
      if (!savedTypeStyles[name] && customStyles.value[name]) {
        savedTypeStyles[name] = customStyles.value[name];
      } else if (!savedTypeStyles[name]) { // Also save ordinal Colors as well
        savedTypeStyles[name] = { color: typeStyling.value.color(name) };
      }
    });
    return savedTypeStyles;
  }

  return {
    stateStyling,
    typeStyling,
    updateTypeStyle,
    populateTypeStyles,
    getTypeStyles,
  };
}
