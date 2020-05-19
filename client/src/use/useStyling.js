import { inject } from '@vue/composition-api';
import colors from 'vuetify/lib/util/colors';
import * as d3 from 'd3';

export default function useStyling() {
  // TODO: what's the proper way to consume vuetify in a composition function?
  const vuetify = inject('vuetify');
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
  const typeColorMap = d3.scaleOrdinal().range(typeColors);
  return { stateStyling, typeColorMap };
}
