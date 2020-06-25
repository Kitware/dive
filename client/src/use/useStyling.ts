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
}

export interface StateStyles {
  standard: Style;
  selected: Style;
  disabled: Style;
}

interface UseStylingParams {
  markChangesPending: () => void;
}


export default function useStyling({ markChangesPending }: UseStylingParams) {
  const vuetify = inject('vuetify') as Vuetify;
  const customColors: Ref<Record<string, string>> = ref({});
  if (!vuetify) {
    throw new Error('Missing vuetify provide/inject');
  }
  // Annotation State Colors
  const standard: Style = {
    strokeWidth: 1,
    opacity: 0.5,
    color: 'type',
  };
  const selected: Style = {
    ...standard,
    color: vuetify.preset.theme.themes.dark.accent as string,
    strokeWidth: 4,
    opacity: 1.0,
  };
  const disabled: Style = {
    ...standard,
    color: 'type',
    strokeWidth: 0.5,
    opacity: 0.45,
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

  function loadTypeColors(list?: Record<string, string>) {
    if (list) {
      // Copy over the item so they can be modified in future
      Object.entries(list).forEach(([key, value]) => {
        Vue.set(customColors.value, key, value);
      });
    }
  }

  function updateTypeColor({ type, color }: { type: string; color: string }) {
    customColors.value[type] = color;
    markChangesPending();
  }

  const ordinalColorMapper = d3.scaleOrdinal<string>().range(typeColors);
  const typeStyling = computed(() => {
    const _customColors = customColors.value;
    return {
      color: (type: string) => {
        if (_customColors[type]) {
          return _customColors[type];
        }
        if (type === '') {
          return ordinalColorMapper.range()[0];
        }
        return ordinalColorMapper(type);
      },
    };
  });

  async function saveTypeColors(
    datasetId: string,
    allTypes: Ref<readonly string[]>,
  ) {
    //We need to remove any unused types in the colors, either deleted or changed
    //Also want to save default colors for reloading
    const savedTypeColors: Record<string, string> = {};
    allTypes.value.forEach((name) => {
      if (!savedTypeColors[name] && customColors.value[name]) {
        savedTypeColors[name] = customColors.value[name];
      } else if (!savedTypeColors[name]) { // Also save ordinal Colors as well
        savedTypeColors[name] = typeStyling.value.color(name);
      }
    });

    await setMetadataForFolder(datasetId, {
      customTypeColors: savedTypeColors,
    });
  }

  return {
    stateStyling, typeStyling, updateTypeColor, loadTypeColors, saveTypeColors,
  };
}
