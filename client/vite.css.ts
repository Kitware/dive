import { resolve } from 'node:path';

import { deprecations } from 'sass';
import type { UserConfig } from 'vite';

const clientRoot = resolve(__dirname);

const activeDeprecations = Object.values(deprecations)
  .filter((deprecation) => deprecation.status === 'active')
  .map((deprecation) => deprecation.id);

const sassOptions = {
  loadPaths: [clientRoot],
  // Suppress warnings from node_modules (e.g. Vuetify).
  quietDeps: true,
  // Suppress all currently active Sass deprecation warnings.
  silenceDeprecations: activeDeprecations,
};

// Vite 6 uses Sass's modern API, which does not resolve bare `src/...` imports
// from the project root unless they are listed in loadPaths.
export const cssConfig: UserConfig['css'] = {
  preprocessorOptions: {
    scss: sassOptions,
    sass: sassOptions,
  },
};
