import Vue from 'vue';
import {
  inject, ref, Ref, computed,
} from '@vue/composition-api';
import * as d3 from 'd3';
import { Vuetify } from 'vuetify';
import { setMetadataForFolder } from '@/lib/api/viame.service';

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

interface UpdateStylingArgs {
  type: string;
  color?: string;
  strokeWidth?: number;
  opacity?: number;
  fill?: boolean;
}
interface UseStylingParams {
  markChangesPending: () => void;
}


export default function useStyling({ markChangesPending }: UseStylingParams) {
  const vuetify = inject('vuetify') as Vuetify;
  const customStyles: Ref<Record<string, CustomStyle>> = ref({});
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
    strokeWidth: 0.5,
    opacity: 0.45,
    fill: false,
  };
  // Colors provided for the different Types
  const stateStyling: StateStyles = { standard, selected, disabled };
  const typeColors = [];


  const numColors = 12; //We can up the number of colors but they will become similar;
  for (let i = 0; i < numColors; i += 1) {
    //We are using a rainbow but we want to skip the cyan area so number will be reduced
    const pos = (i * (1 / numColors));
    if (pos > 0.58 && pos < 0.63) {
      break;
    }
    const baseColor = d3.color(d3.interpolateRainbow(pos))?.hex();
    if (baseColor) {
      //typeColors.push(baseColor);
      const hueColor = d3.hsl(baseColor);
      hueColor.s = 1.0;
      hueColor.l = 0.5;
      typeColors.push(hueColor.hex());
      hueColor.s = 0.5;
      hueColor.l = 0.35;
      typeColors.push(hueColor.hex());
      hueColor.s = 1.0;
      hueColor.l = 0.75;
      typeColors.push(hueColor.hex());
    }
  }

  //Mix up colors in a uniform way for each launch
  let seed = 0.5;
  typeColors.sort(() => {
    seed += seed;
    return Math.cos(seed);
  });

  function loadTypeStyles({ styles, colorList }:
    { styles?: Record<string, CustomStyle>; colorList?: Record<string, string> }) {
    //Handles old style Colors first
    if (colorList) {
      Object.entries(colorList).forEach(([key, value]) => {
        if (!customStyles.value[key]) {
          Vue.set(customStyles.value, key, {});
        }
        Vue.set(customStyles.value[key], 'color', value);
      });
    }
    if (styles) {
      // Copy over the item so they can be modified in future
      Object.entries(styles).forEach(([key, value]) => {
        Vue.set(customStyles.value, key, value);
      });
    }
  }

  function updateTypeStyle(args: UpdateStylingArgs) {
    const { type } = args;
    if (!customStyles.value[type]) {
      Vue.set(customStyles.value, type, {});
    }
    Object.entries(args).forEach(([key, value]) => {
      if (value !== undefined) {
        if (!customStyles.value[type]) {
          Vue.set(customStyles.value, type, {});
        }
        Vue.set(customStyles.value[type], key, value);
      }
    });
    markChangesPending();
  }

  const ordinalColorMapper = d3.scaleOrdinal<string>().range(typeColors);
  const typeStyling = computed(() => {
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

  async function saveTypeStyles(
    datasetId: string,
    allTypes: Ref<readonly string[]>,
  ) {
    //We need to remove any unused types in the colors, either deleted or changed
    //Also want to save default colors for reloading
    const savedTypeStyles: Record<string, CustomStyle> = {};
    allTypes.value.forEach((name) => {
      if (!savedTypeStyles[name] && customStyles.value[name]) {
        savedTypeStyles[name] = customStyles.value[name];
      } else if (!savedTypeStyles[name]) { // Also save ordinal Colors as well
        savedTypeStyles[name] = { color: typeStyling.value.color(name) };
      }
    });

    await setMetadataForFolder(datasetId, {
      customTypeStyling: savedTypeStyles,
    });
  }

  return {
    stateStyling,
    typeStyling,
    updateTypeStyle,
    loadTypeStyles,
    saveTypeStyles,
  };
}
