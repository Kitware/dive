import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import vue from '@vitejs/plugin-vue';
import type { UserConfig } from 'vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import vuetify from 'vite-plugin-vuetify';

import packageJson from './package.json';
import {
  gwcInternalAlias,
  gwcInternalEsbuildAlias,
  gwcSrcRoot,
} from './vite-plugins/gwcInternalAlias';

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
      gwcInternalAlias(),
      vue({
        include: [/\.vue$/],
      }),
      vuetify({ autoImport: true }),
    ],
    resolve: {
      extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.vue'],
      dedupe: ['axios', 'vue', 'vuetify'],
      alias: {
        'dive-common': resolve(__dirname, 'dive-common'),
        'vue-media-annotator': resolve(__dirname, 'src'),
        platform: resolve(__dirname, 'platform'),
        '@girder/components': resolve(__dirname, 'node_modules/@girder/components/src'),
        'vuetify/lib/util/colors': 'vuetify/util/colors',
        'vuetify/lib': 'vuetify',
        '@girder/components/plugins': join(gwcSrcRoot, 'plugins/index.js'),
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
      esbuildOptions: {
        plugins: [gwcInternalEsbuildAlias()],
      },
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
      setupFiles: ['./vitest.girder-mock.ts'],
      server: {
        deps: {
          inline: ['@girder/components'],
        },
      },
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
