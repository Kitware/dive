import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue2';
import typescript from '@rollup/plugin-typescript';
import scss from 'rollup-plugin-scss';
import { resolve } from 'path';
import cleaner from 'rollup-plugin-cleaner';

// Define external dependencies
const external = [
  'vue',
  '@flatten-js/interval-tree',
  'd3',
  'geojs',
  'lodash',
  // Externalize the main file from platform/web-girder
  resolve(__dirname, 'platform/web-girder/main.ts'),

];

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'vue-media-annotator',
      fileName: (format) => `vue-media-annotator.${format}.js`,
      formats: ['es'],
    },
    rollupOptions: {
      external,
      output: {
        dir: 'lib',
      },
      plugins: [
        cleaner({
          targets: ['lib'],
        }),
        typescript({
          tsconfig: resolve(__dirname, 'tsconfig.rollup.json'),
        }),
        vue(),
        scss(),
      ],
    },
  },
});
