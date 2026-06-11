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
        return resolveGwcPath(source.slice('@girder/components/'.length));
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
  '@girder/components': resolve(gwcSrc, 'index.js'),
};
