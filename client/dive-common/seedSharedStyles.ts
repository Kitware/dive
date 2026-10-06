import type { CustomStyle } from 'vue-media-annotator/StyleManager';

/**
 * Add to the shared style store every style it does not already hold, stamped with the
 * dataset it came from. Existing shared choices win. A type with nothing to share is left
 * out: a species list declares its types with an empty style, and a curated list runs to
 * hundreds of entries, so seeding them would list every declared species in the store and
 * carry it into every dataset opened with shared colors on.
 */
export default function seedSharedStyles(
  into: Record<string, CustomStyle>,
  from: Record<string, CustomStyle>,
  source: { sourceDatasetId: string; sourceDatasetName: string },
): { next: Record<string, CustomStyle>; changed: boolean } {
  let changed = false;
  const next = { ...into };
  Object.entries(from).forEach(([name, style]) => {
    if (name in next || !Object.keys(style).length) {
      return;
    }
    next[name] = { ...style, ...source };
    changed = true;
  });
  return { next, changed };
}
