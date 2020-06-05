import { inject } from '@vue/composition-api';
import colors from 'vuetify/lib/util/colors';
import * as d3 from 'd3';
import { Vuetify } from 'vuetify';

interface Style{
  strokeWidth: number;
  opacity: number;
  color: string;

}
export interface StateStyles {
  standard: Style;
  selected: Style;
  disabled: Style;
}


export default function useStyling() {
  const vuetify = inject('vuetify') as Vuetify;
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
  const typeColorMapper = d3.scaleOrdinal().range(typeColors) as (t: string) => string;
  return { stateStyling, typeColorMapper };
}
