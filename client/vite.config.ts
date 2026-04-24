import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import vue from '@vitejs/plugin-vue2';
import type { UserConfig } from 'vite';
import { defineConfig, loadEnv } from 'vite';

import packageJson from './package.json';

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
    plugins: [vue()],
    resolve: {
      dedupe: ['axios', 'vue', 'vuetify'],
      alias: {
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
      },
    },
    optimizeDeps: {
      include: ['axios', 'qs', 'markdown-it', 'js-cookie'],
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
    base: mode === 'production' ? '/static/viame/' : '/',
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
