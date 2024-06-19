import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue2';
import path from 'path';
import { gitDescribeSync } from 'git-describe';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { VuetifyResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import http from 'http';

import packagejson from './package.json';

const gitHash = gitDescribeSync().hash;
const { version } = packagejson;
const keepAliveAgent = new http.Agent({ keepAlive: true });
const staticPath = process.env.NODE_ENV === 'production' ? process.env.VUE_APP_STATIC_PATH || './static/dive' : './';

export default defineConfig({
  base: './',
  optimizeDeps: {
    include: ['axios', 'qs', 'markdown-it', 'js-cookie'],
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
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: 'kitware-data',
      project: 'viame-web-client',
      release: process.env.VITE_APP_GIT_HASH,
      include: './dist',
    }),
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
  build: {
    sourcemap: true,
    outDir: 'dist',
    rollupOptions: {
      input: {
        app: './index.web.html', // default
      },
    },
  },
  define: {
    'process.env.VITE_APP_GIT_HASH': JSON.stringify(gitHash),
    'process.env.VITE_APP_VERSION': JSON.stringify(version),
  },
});
