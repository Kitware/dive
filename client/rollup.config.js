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

export default [
  {
    external,
    input: './src/index.ts',
    output: {
      dir: './dist/',
      format: 'esm',
      name: 'vue-media-annotator',
    },
    plugins: [
      // clear out dist before build
      cleaner({ targets: ['dist'] }),
      typescript({
        clean,
        tsconfig,
        useTsconfigDeclarationDir: true,
      }),
    ],
  },
  {
    external,
    input: './src/components/index.js',
    plugins: [
      typescript({
        // don't use build cache
        clean,
        tsconfig,
        tsconfigOverride: {
          compilerOptions: {
            declaration: false,
          },
          include: [
            'src/**/*.ts',
            'src/**/*.tsx',
            /**
             * TODO: DANGER: this line should not be needed
             * nothing from app/ ends up in the built artifact.
             * nothing from app/ is imported from src/components/index.js
             * ...but the build fails without it.
             */
            'app/**/*.ts',
          ],
        },
      }),
      vue(),
      scss(),
    ],
    output: {
      file: './dist/components.js',
      format: 'esm',
    },
  },
];
