import type Vuetify from 'vuetify';

import {
  ref, Ref, computed, set as VueSet,
} from '@vue/composition-api';
import * as d3 from 'd3';
import { noop, merge } from 'lodash';
import { ScaleOrdinal } from 'd3';

interface Style {
  strokeWidth: number;
  opacity: number;
  color: string;
  fill: boolean;
  showLabel: boolean;
  showConfidence: boolean;
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
  showLabel?: boolean;
  showConfidence?: boolean;
}

export interface TypeStyling {
  color: (type: string) => string;
  strokeWidth: (type: string) => number;
  fill: (type: string) => boolean;
  opacity: (type: string) => number;
  labelSettings: (type: string) => { showLabel: boolean; showConfidence: boolean };
}

interface UseStylingParams {
  markChangesPending: () => void;
  vuetify?: Vuetify;
}

/**
   * Generates a color pallette as a list of hex colors.
   * It generates colors from a rainbow spectrum and then takes a dark and lighter version
   * of each color.
   * @param {int} numColors - number of colors to attempt to generate the higher
   * the number the more similar the colors will be.  Cyan like colors will be filtered out,
   * so numColors isn't a guarantee of x*3 (normal, dark, light) colors.
   */
export function generateColors(numColors: number) {
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

const defaultStaticStyles: Record<string, CustomStyle> = {
  'no-group': {
    color: '#ffffff',
  },
};

export default class StyleManager {
  /**
   * Revision counter should be watched for re-rendering based on customStyles
   * because we're using geojs's styling functions, which will not be invoked until render,
   * so we can't use deep watching to trigger re-render (chicken and egg).
   */
  revisionCounter: Ref<number>;

  customStyles: Ref<Record<string, CustomStyle>>;

  stateStyles: StateStyles;

  typeColors: ScaleOrdinal<string, string>;

  typeStyling: Ref<TypeStyling>;

  markChangesPending: () => void;

  constructor({ markChangesPending, vuetify }: UseStylingParams) {
    this.revisionCounter = ref(1);
    this.customStyles = ref({} as Record<string, CustomStyle>);
    // Annotation State Colors
    const standard: Style = {
      strokeWidth: 3,
      opacity: 1.0,
      color: 'type',
      fill: false,
      showLabel: true,
      showConfidence: true,
    };
    const selected: Style = {
      ...standard,
      color: vuetify?.preset.theme.themes.dark.accent as string || 'cyan',
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
    this.stateStyles = { standard, selected, disabled };
    this.typeColors = d3.scaleOrdinal<string>().range(generateColors(10));
    this.markChangesPending = markChangesPending;
    this.typeStyling = computed(() => {
      // establish dependency on revision counter
      if (this.revisionCounter.value) noop();
      const _customStyles = this.customStyles.value;
      return {
        color: (type: string) => {
          if (_customStyles[type] && _customStyles[type].color) {
            return _customStyles[type].color;
          }
          if (type === '') {
            return this.typeColors.range()[0];
          }
          return this.typeColors(type);
        },
        strokeWidth: (type: string) => {
          if (_customStyles[type] && _customStyles[type].strokeWidth) {
            return _customStyles[type].strokeWidth;
          }
          return this.stateStyles.standard.strokeWidth;
        },
        fill: (type: string) => {
          if (_customStyles[type] && _customStyles[type].fill !== undefined) {
            return _customStyles[type].fill;
          }
          return this.stateStyles.standard.fill;
        },
        opacity: (type: string) => {
          if (_customStyles[type] && _customStyles[type].opacity) {
            return _customStyles[type].opacity;
          }
          return this.stateStyles.standard.opacity;
        },
        labelSettings: (type: string) => {
          let { showLabel, showConfidence } = this.stateStyles.standard;
          if (_customStyles[type]) {
            if (typeof (_customStyles[type].showLabel) === 'boolean') {
              showLabel = _customStyles[type].showLabel as boolean;
            }
            if (typeof (_customStyles[type].showConfidence) === 'boolean') {
              showConfidence = _customStyles[type].showConfidence as boolean;
            }
          }
          return { showLabel, showConfidence };
        },
      } as TypeStyling;
    });
  }

  populateTypeStyles(styles?: Record<string, CustomStyle>) {
    if (styles) {
      this.customStyles.value = {
        ...defaultStaticStyles,
        ...styles,
      };
    } else {
      this.customStyles.value = defaultStaticStyles;
    }
  }

  updateTypeStyle(args: {
    type: string;
    value: CustomStyle;
  }) {
    const { type, value } = args;
    const oldValue = this.customStyles.value[type] || {};
    VueSet(this.customStyles.value, type, merge(oldValue, value));
    this.revisionCounter.value += 1;
    this.markChangesPending();
  }

  getTypeStyles(allTypes: Ref<readonly string[]>) {
    //We need to remove any unused types in the colors, either deleted or changed
    //Also want to save default colors for reloading
    const savedTypeStyles = {} as Record<string, CustomStyle>;
    allTypes.value.forEach((name) => {
      if (!savedTypeStyles[name] && this.customStyles.value[name]) {
        savedTypeStyles[name] = this.customStyles.value[name];
      } else if (!savedTypeStyles[name]) { // Also save ordinal Colors as well
        savedTypeStyles[name] = { color: this.typeStyling.value.color(name) };
      }
    });
    return savedTypeStyles;
  }
}
