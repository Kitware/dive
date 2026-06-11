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
export function buildMaterialPaletteColors(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [exportName, kebabName] of Object.entries(paletteNames)) {
    const palette = colors[exportName as keyof typeof colors];
    if (!palette || typeof palette !== 'object') continue;
    for (const [shade, hex] of Object.entries(palette as Record<string, string>)) {
      result[`${kebabName}-${shadeToKebab(shade)}`] = hex;
    }
  }
  return result;
}
