import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin as EsbuildPlugin } from 'esbuild';
import type { Plugin as VitePlugin } from 'vite';

const gwcSrcRoot = resolve(__dirname, '../node_modules/@girder/components/src');

function resolveGwcInternalPath(source: string): string | null {
  if (!source.startsWith('@/')) {
    return null;
  }

  const relativePath = source.slice(2).replace(/\/$/, '');
  const target = join(gwcSrcRoot, relativePath);
  const candidates = [
    `${target}.js`,
    `${target}.ts`,
    `${target}.vue`,
    join(target, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return join(target, 'index.js');
}

function isGwcImporter(importer?: string): boolean {
  return importer?.includes('@girder/components') ?? false;
}

export function gwcInternalAlias(): VitePlugin {
  return {
    name: 'gwc-internal-alias',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!isGwcImporter(importer)) {
        return null;
      }
      return resolveGwcInternalPath(source);
    },
  };
}

export function gwcInternalEsbuildAlias(): EsbuildPlugin {
  return {
    name: 'gwc-internal-alias',
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        if (!isGwcImporter(args.importer)) {
          return null;
        }

        const resolved = resolveGwcInternalPath(args.path);
        return resolved ? { path: resolved } : null;
      });
    },
  };
}

export { gwcSrcRoot };
