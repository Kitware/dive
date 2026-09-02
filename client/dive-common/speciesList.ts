import type { CustomStyle } from 'vue-media-annotator/StyleManager';

/**
 * Fold one species list into a dataset's declared type styling.
 *
 * DIVE stores the declared type list as the keys of `customTypeStyling`; a name with no style
 * of its own renders in the ordinal palette, so declaring a species costs an empty entry.
 * Overwrite makes the file the whole declaration and drops the types it omits, keeping the
 * styles of the ones it names. Additive adds what is missing and keeps every type already
 * declared. Neither mode can orphan annotations: a type a track uses is listed from its
 * confidence pairs whether or not it is declared here.
 *
 * Mirrors `_declare_species_types` in server/dive_server/crud_rpc.py so a species list imported
 * on Desktop and on Web produces the same dataset configuration.
 */
export default function declareSpeciesTypes(
  existing: Record<string, CustomStyle>,
  names: readonly string[],
  additive: boolean,
): Record<string, CustomStyle> {
  const declared: Record<string, CustomStyle> = {};
  names.forEach((name) => {
    declared[name] = existing[name] ?? {};
  });
  return additive ? { ...existing, ...declared } : declared;
}
