import * as d3 from 'd3';
import colors from 'vuetify/lib/util/colors';

export default function useTypeColoring() {
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
  return { typeColorMap };
}
