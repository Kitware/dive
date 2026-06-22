import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Plugin } from 'vite';

const gwcSrc = resolve(__dirname, 'node_modules/@girder/components/src');

function resolveExistingFile(base: string) {
  const candidates = [`${base}.vue`, `${base}.js`, resolve(base, 'index.js'), base];
  return candidates.find((candidate) => (
    existsSync(candidate) && !statSync(candidate).isDirectory()
  ));
}

function resolveGwcPath(subpath: string) {
  return resolveExistingFile(resolve(gwcSrc, subpath)) || `${resolve(gwcSrc, subpath)}.js`;
}

export function girderComponentsResolver(): Plugin {
  const isGwcImporter = (importer?: string) => (
    !!importer && (importer.includes('@girder/components') || importer.startsWith(gwcSrc))
  );

  return {
    name: 'girder-components-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '@girder/components' || source === '@girder/components/') {
        return resolve(gwcSrc, 'index.js');
      }
      if (source.startsWith('@girder/components/')) {
        let subpath = source.slice('@girder/components/'.length);
        // gwcSrc already points at .../src; strip a redundant src/ prefix.
        if (subpath.startsWith('src/')) {
          subpath = subpath.slice('src/'.length);
        }
        return resolveGwcPath(subpath);
      }
      if (source.startsWith('@/') && isGwcImporter(importer)) {
        return resolveGwcPath(source.slice(2));
      }
      if (importer?.startsWith(gwcSrc) && source.startsWith('.')) {
        const resolved = resolveExistingFile(resolve(dirname(importer), source));
        if (resolved) {
          return resolved;
        }
      }
      return undefined;
    },
  };
}

export const girderComponentsAlias = {
  // Directory alias so subpaths (e.g. plugins/vuetifyConfig.js) resolve correctly.
  '@girder/components': gwcSrc,
};
