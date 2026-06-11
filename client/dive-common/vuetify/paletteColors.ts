import colors from 'vuetify/lib/util/colors';

const paletteNames: Record<string, string> = {
  red: 'red',
  pink: 'pink',
  purple: 'purple',
  deepPurple: 'deep-purple',
  indigo: 'indigo',
  blue: 'blue',
  lightBlue: 'light-blue',
  cyan: 'cyan',
  teal: 'teal',
  green: 'green',
  lightGreen: 'light-green',
  lime: 'lime',
  yellow: 'yellow',
  amber: 'amber',
  orange: 'orange',
  deepOrange: 'deep-orange',
  brown: 'brown',
  blueGrey: 'blue-grey',
  grey: 'grey',
};

function shadeToKebab(shade: string): string {
  if (shade === 'base') return 'base';
  return shade.replace(/(\d+)$/, '-$1');
}

/** Material palette aliases (e.g. grey-darken-1) for Vuetify 3 color props. */
export default function buildMaterialPaletteColors(): Record<string, string> {
  return Object.entries(paletteNames).reduce((result, [exportName, kebabName]) => {
    const palette = colors[exportName as keyof typeof colors];
    if (!palette || typeof palette !== 'object') {
      return result;
    }
    const paletteEntries = Object.entries(palette as Record<string, string>).reduce(
      (acc, [shade, hex]) => ({
        ...acc,
        [`${kebabName}-${shadeToKebab(shade)}`]: hex,
      }),
      {} as Record<string, string>,
    );
    return { ...result, ...paletteEntries };
  }, {} as Record<string, string>);
}
