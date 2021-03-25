const { gitDescribeSync } = require('git-describe');
const path = require('path');
const http = require('http');
const packagejson = require('./package.json');

const keepAliveAgent = new http.Agent({ keepAlive: true });

process.env.VUE_APP_GIT_HASH = gitDescribeSync().hash;
process.env.VUE_APP_VERSION = packagejson.version;

function chainWebpack(config) {
  config.output.strictModuleExceptionHandling(true);
  config.resolve.symlinks(false);
  config.resolve.alias.set('dive-common', path.resolve(__dirname, 'dive-common'));
  config.resolve.alias.set('vue-media-annotator', path.resolve(__dirname, 'src'));
  config.resolve.alias.set('platform', path.resolve(__dirname, 'platform'));
}

module.exports = {
  devServer: {
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        secure: false,
        ws: true,
        agent: keepAliveAgent,
      },
    },
  },
  productionSourceMap: false,
  publicPath: process.env.VUE_APP_STATIC_PATH,
  chainWebpack,
  pluginOptions: {
    electronBuilder: {
      mainProcessFile: 'platform/desktop/background.ts',
      // https://github.com/nklayman/vue-cli-plugin-electron-builder/pull/1088
      rendererProcessFile: 'platform/desktop/main.ts',
      // https://www.electron.build/configuration/configuration
      builderOptions: {
        appId: 'com.kitware.viame',
        productName: 'DIVE-Desktop',
        copyright: 'Copyright © 2020 Kitware, Inc.',
        // extraMetadata will be merged with package.json in args to electron-builder
        extraMetadata: {
          // https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/188
          // https://github.com/electron-userland/electron-builder/issues/2592
          main: 'background.js',
        },
        linux: {
          target: ['AppImage', 'snap', 'tar.gz'],
          // eslint-disable-next-line no-template-curly-in-string
          artifactName: 'DIVE-Desktop-${version}.${ext}',
        },
        win: {
          target: ['nsis', 'portable', 'msi', 'zip'],
          // eslint-disable-next-line no-template-curly-in-string
          artifactName: 'DIVE-Desktop-${version}.${ext}',
          icon: 'dive-common/assets/windows.ico',
        },
      },
      chainWebpackMainProcess: chainWebpack,
      /**
       * Node Integration is needed for this app,
       * so we will have to be careful with RCE
       * and issues with running unsafe scripts
       */
      nodeIntegration: true,
    },
  },
};
