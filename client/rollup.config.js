import vue from 'rollup-plugin-vue';
// use this instead of the official @rollup/plugin-typescript
// because official doesn't work and this one actually has
// more community support
import typescript from 'rollup-plugin-typescript2';
import scss from 'rollup-plugin-scss';
import cleaner from 'rollup-plugin-cleaner';

const clean = true;
const tsconfig = 'tsconfig.rollup.json';
const external = [
  '@vue/composition-api',
  '@flatten-js/interval-tree',
  'd3',
  'geojs',
  'lodash',
  'vue',
];

export default {
  external,
  input: './src/index.ts',
  output: {
    dir: './lib/',
    format: 'esm',
    name: 'vue-media-annotator',
  },
  plugins: [
    // clear out dist before build
    cleaner({ targets: ['lib'] }),
    typescript({
      clean,
      tsconfig,
      useTsconfigDeclarationDir: true,
      tsconfigOverride: {
        include: [
          'src/**/*.ts',
          'src/**/*.tsx',
        ],
      },
    }),
    vue(),
    scss(),
  ],
};
