import { defineConfig } from 'vite';
import { createVuePlugin as vue } from 'vite-plugin-vue2';
import { gitDescribeSync } from 'git-describe';
import path from 'path';
import { createHtmlPlugin } from 'vite-plugin-html';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { VuetifyResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';

import electron from 'vite-plugin-electron';
import http from 'http';
import packagejson from './package.json';

const keepAliveAgent = new http.Agent({ keepAlive: true });

const gitHash = gitDescribeSync().hash;
const { version } = packagejson;
const staticPath = process.env.NODE_ENV === 'production' ? process.env.VUE_APP_STATIC_PATH || './static/dive' : './';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  return {
    base: './',
    optimizeDeps: { include: ['axios', 'qs', 'markdown-it', 'js-cookie'] },
    define: {
      'process.env.VITE_APP_GIT_HASH': JSON.stringify(gitHash),
      'process.env.VITE_APP_VERSION': JSON.stringify(version),
    },
    plugins: [
      vue(),
      Components({
        resolvers: [
          // Vuetify
          VuetifyResolver(),
        ],
        // Don't exclude girder web components
        exclude: [
          /[\\/]node_modules[\\/](?!(@girder[\\/]components[\\/]|\.pnpm[\\/]@girder.*))/,
          /[\\/]\.git[\\/]/,
          /[\\/]\.nuxt[\\/]/,
        ],
      }),
    //   createHtmlPlugin({
    //     inject: {
    //       data: {
    //         title: 'DIVE',
    //         VITE_APP_GIT_HASH: gitHash,
    //         VITE_APP_VERSION: version,
    //       },
    //     },
    //   }),
    //   isProduction && process.env.SENTRY_AUTH_TOKEN ? sentryVitePlugin({
    //     authToken: process.env.SENTRY_AUTH_TOKEN,
    //     org: 'kitware-data',
    //     project: 'viame-web-client',
    //     release: gitHash,
    //     include: './dist',
    //   }) : undefined,
    //   electron({
    //     entry: 'platform/desktop/background.ts', // Path to your Electron main process entry file
    //   }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './platform'),
        'vue-media-annotator': path.resolve(__dirname, './src'),
        'dive-common': path.resolve(__dirname, './dive-common'),
        platform: path.resolve(__dirname, './platform'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 8080,
      proxy: {
        '/api': {
          target: 'http://localhost:8010',
          secure: false,
          ws: true,
          agent: keepAliveAgent,
        },
      },
      publicPath: staticPath,
      strictPort: true,
    },
  };
});
