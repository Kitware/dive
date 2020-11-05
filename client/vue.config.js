const { gitDescribeSync } = require('git-describe');
const path = require('path');
const packagejson = require('./package.json');

process.env.VUE_APP_GIT_HASH = gitDescribeSync().hash;
process.env.VUE_APP_VERSION = packagejson.version;

module.exports = {
  devServer: {
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        secure: false,
      },
    },
  },
  productionSourceMap: false,
  publicPath: process.env.VUE_APP_STATIC_PATH,
  chainWebpack: (config) => {
    config.output.strictModuleExceptionHandling(true);
    config.resolve.symlinks(false);
    config.resolve.alias.set('viame-web-common', path.resolve(__dirname, 'viame-web-common'));
    config.resolve.alias.set('vue-media-annotator', path.resolve(__dirname, 'src'));
    config.resolve.alias.set('platform', path.resolve(__dirname, 'platform'));
  },
  pluginOptions: {
    electronBuilder: {
      mainProcessFile: 'platform/desktop/background.ts',
      // https://github.com/nklayman/vue-cli-plugin-electron-builder/pull/1088
      rendererProcessFile: 'platform/desktop/main.ts',
      builderOptions: {
        // extraMetadata will be merged with package.json in args to electron-builder
        extraMetadata: {
          // https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/188
          // https://github.com/electron-userland/electron-builder/issues/2592
          main: 'background.js',
        },
      },
      /**
       * Node Integration is needed for this app,
       * so we will have to be careful with RCE
       * and issues with running unsafe scripts
       */
      nodeIntegration: true,
    },
  },
};
