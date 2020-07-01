import Vue from 'vue';
import {
  inject, ref, Ref, computed,
} from '@vue/composition-api';
import colors from 'vuetify/lib/util/colors';
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
  const typeColors = [
    colors.red.accent1,
    colors.yellow.darken3,
    colors.purple.lighten3,
    colors.green.lighten3,
    colors.yellow.lighten3,
    colors.purple.darken3,
    colors.green.darken3,
  ];

  function loadTypeStyles({ styles, colorList }:
    { styles?: Record<string, CustomStyle>; colorList?: Record<string, string> }) {
    //Handles old style Colors first
    if (colorList) {
      Object.entries(colorList).forEach(([key, value]) => {
        if (!customStyles.value[key]) {
          customStyles.value[key] = {};
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


  function updateTypeStyle({
    type, color, strokeWidth, opacity, fill,
  }:
    {type: string; color?: string; strokeWidth?: number; opacity?: number; fill?: boolean}) {
    if (!customStyles.value[type]) {
      Vue.set(customStyles.value, type, {});
    }
    const args = {
      color, strokeWidth, opacity, fill,
    };
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
