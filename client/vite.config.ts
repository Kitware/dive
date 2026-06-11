import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import type { Plugin, UserConfig } from 'vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

import packageJson from './package.json';

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

function girderComponentsResolver(): Plugin {
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

function getGitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const webOverrides: UserConfig = {
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const gitHash = getGitHash();
  const devPort = Number(env.VITE_PORT || 8080);
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8010';

  const sharedConfig: UserConfig = {
    plugins: [
      girderComponentsResolver(),
      vue(),
      vuetify({ autoImport: true }),
    ],
    resolve: {
      dedupe: ['axios', 'vue', 'vuetify'],
      alias: {
        '@girder/components': resolve(gwcSrc, 'index.js'),
        'dive-common': resolve(__dirname, 'dive-common'),
        'vue-media-annotator': resolve(__dirname, 'src'),
        platform: resolve(__dirname, 'platform'),
      },
    },
    define: {
      'process.env': JSON.stringify({
        ...env,
        NODE_ENV: mode,
        VUE_APP_GIT_HASH: gitHash,
        VUE_APP_VERSION: packageJson.version,
      }),
    },
    server: {
      host: '0.0.0.0',
      port: Number.isFinite(devPort) ? devPort : 8080,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          secure: false,
          ws: true,
        },
        '/notifications': {
          target: apiProxyTarget,
          secure: false,
          ws: true,
        },
      },
    },
    optimizeDeps: {
      include: ['axios', 'qs', 'markdown-it', 'js-cookie'],
      exclude: ['@girder/components', 'vue-gtag'],
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        external: ['vtk.js'],
        output: {
          globals: {
            'vtk.js': 'vtkjs',
          },
        },
      },
    },
    base: '/',
    test: {
      globals: true,
    },
  };

  return {
    ...sharedConfig,
    ...webOverrides,
    plugins: [
      ...(sharedConfig.plugins || []),
      ...(webOverrides.plugins || []),
    ],
    resolve: {
      ...sharedConfig.resolve,
      ...webOverrides.resolve,
      alias: {
        ...(sharedConfig.resolve as UserConfig['resolve'])?.alias,
        ...(webOverrides.resolve as UserConfig['resolve'])?.alias,
      },
    },
    server: {
      ...sharedConfig.server,
      ...webOverrides.server,
    },
    build: {
      ...sharedConfig.build,
      ...webOverrides.build,
      rollupOptions: {
        ...(sharedConfig.build as UserConfig['build'])?.rollupOptions,
        ...(webOverrides.build as UserConfig['build'])?.rollupOptions,
        output: {
          ...((sharedConfig.build as UserConfig['build'])?.rollupOptions as any)?.output,
          ...((webOverrides.build as UserConfig['build'])?.rollupOptions as any)?.output,
          globals: {
            ...((((sharedConfig.build as UserConfig['build'])?.rollupOptions as any)?.output || {}).globals),
            ...((((webOverrides.build as UserConfig['build'])?.rollupOptions as any)?.output || {}).globals),
          },
        },
      },
    },
  };
});
