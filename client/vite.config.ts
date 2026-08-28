import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import vue from '@vitejs/plugin-vue2';
import type { UserConfig } from 'vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

import packageJson from './package.json';
import { cssConfig } from './vite.css';

const testExcludes = ['**/node_modules/**', '**/bin/**'];
const domTests = [
  'src/components/**/*.spec.ts',
  'dive-common/components/**/*.spec.ts',
  'platform/web-girder/api/multicamResolve.spec.ts',
  'platform/web-girder/store/webGirderStoreComposables.spec.ts',
  'platform/web-girder/views/Upload.spec.ts',
  'platform/web-girder/views/UploadGirder.spec.ts',
];

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
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const gitHash = getGitHash();
  const devPort = Number(env.VITE_PORT || 8080);
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8010';

  const sharedConfig: UserConfig = {
    css: cssConfig,
    plugins: [vue()],
    resolve: {
      dedupe: ['axios', 'vue', 'vuetify'],
      alias: {
        // Force a single Vue build; production Rollup can otherwise bundle both
        // vue.runtime.esm.js (from vuetify/lib) and vue.runtime.common.prod.js (from vuetify dist).
        vue: resolve(__dirname, 'node_modules/vue/dist/vue.runtime.esm.js'),
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
        // WebSocket for Girder notifications (not under /api; see notificatonBus.ts).
        '/notifications': {
          target: apiProxyTarget,
          secure: false,
          ws: true,
        },
      },
    },
    optimizeDeps: {
      include: [
        'axios',
        'qs',
        'markdown-it',
        'js-cookie',
        'vue',
        'vuetify',
        '@girder/components/src',
      ],
      // onnxruntime locates its .wasm relative to its own module URL. Pre-bundled
      // into node_modules/.vite/deps that resolves to a path the dev server
      // answers with the SPA HTML fallback, so the runtime fails to instantiate.
      // Served unbundled, the .wasm sits next to the module and loads. The
      // production build already emits it as a hashed asset either way.
      exclude: ['onnxruntime-web'],
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
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            exclude: [...testExcludes, ...domTests],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: domTests,
            exclude: testExcludes,
          },
        },
      ],
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
