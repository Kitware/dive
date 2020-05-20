import { inject } from '@vue/composition-api';
import colors from 'vuetify/lib/util/colors';
import * as d3 from 'd3';
import { Vuetify } from 'vuetify';

export default function useStyling() {
  const vuetify = <Vuetify> inject('vuetify');
  if (!vuetify) {
    throw new Error('Missing vuetify provide/inject');
  }
  // Annotation State Colors
  const standard = {
    strokeWidth: 1,
    opacity: 0.5,
  };
  const selected = {
    ...standard,
    color: vuetify.preset.theme.themes.dark.accent,
    strokeWidth: 4,
    opacity: 1.0,
  };
  const disabled = {
    ...standard,
    color: '#777777',
    opacity: 0.7,
  };
  // Colors provided for the different Types
  const stateStyling = { standard, selected, disabled };
  const typeColors = [
    colors.red.accent1,
    colors.yellow.darken3,
    colors.purple.lighten3,
    colors.green.lighten3,
    colors.yellow.lighten3,
    colors.purple.darken3,
    colors.green.darken3,
  ];
  const typeColorMapper = d3.scaleOrdinal().range(typeColors) as (t: string) => string;
  return { stateStyling, typeColorMapper };
}
