import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import vue from '@vitejs/plugin-vue2';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { loadEnv } from 'vite';

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const gitHash = getGitHash();
  const devPort = Number(env.VITE_PORT || 8080);
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8010';

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          'dive-common': resolve(__dirname, 'dive-common'),
          'vue-media-annotator': resolve(__dirname, 'src'),
          platform: resolve(__dirname, 'platform'),
        },
      },
      build: {
        outDir: '.electron/main',
        sourcemap: true,
        rollupOptions: {
          input: resolve(__dirname, 'platform/desktop/background.ts'),
          output: {
            entryFileNames: 'background.js',
          },
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          'dive-common': resolve(__dirname, 'dive-common'),
          'vue-media-annotator': resolve(__dirname, 'src'),
          platform: resolve(__dirname, 'platform'),
        },
      },
      build: {
        outDir: '.electron/main',
        emptyOutDir: false,
        sourcemap: true,
        rollupOptions: {
          input: resolve(__dirname, 'platform/desktop/preload.ts'),
          output: {
            entryFileNames: 'preload.js',
          },
        },
      },
    },
    renderer: {
      root: resolve(__dirname, '.'),
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
        host: '127.0.0.1',
        port: Number.isFinite(devPort) ? devPort : 8080,
        strictPort: false,
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
        outDir: 'dist_desktop',
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
          input: resolve(__dirname, 'desktop.html'),
          external: ['vtk.js'],
          output: {
            globals: {
              'vtk.js': 'vtkjs',
            },
          },
        },
      },
      base: './',
    },
  };
});
