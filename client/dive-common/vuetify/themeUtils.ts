/** Read a theme color from Vuetify 3 (with fallbacks for legacy/test shapes). */
// eslint-disable-next-line import/prefer-default-export
export function getThemeColor(
  vuetify: {
    theme?: {
      global?: { current?: { value?: { colors?: Record<string, string> } } };
      themes?: { dark?: Record<string, string> };
    };
    preset?: { theme?: { themes?: { dark?: Record<string, string> } } };
  } | undefined,
  name: string,
  fallback = '',
): string {
  const v3Color = vuetify?.theme?.global?.current?.value?.colors?.[name];
  if (v3Color) return v3Color;

  const v2Dark = vuetify?.theme?.themes?.dark?.[name]
    ?? vuetify?.preset?.theme?.themes?.dark?.[name];
  if (v2Dark) return v2Dark;

  return fallback;
}
