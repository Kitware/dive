const { gitDescribeSync } = require('git-describe');
const path = require('path');
const http = require('http');
const packagejson = require('./package.json');
const SentryPlugin = require('@sentry/webpack-plugin');

const keepAliveAgent = new http.Agent({ keepAlive: true });

process.env.VUE_APP_GIT_HASH = gitDescribeSync().hash;
process.env.VUE_APP_VERSION = packagejson.version;

function chainWebpack(config) {
  config.output.strictModuleExceptionHandling(true);
  config.resolve.symlinks(false);
  config.resolve.alias.set('dive-common', path.resolve(__dirname, 'dive-common'));
  config.resolve.alias.set('vue-media-annotator', path.resolve(__dirname, 'src'));
  config.resolve.alias.set('platform', path.resolve(__dirname, 'platform'));
  config.externals({
    /**
     * Specify vtkjs as external dependency on global context to
     * prevent it from being included in bundle (2MB savings)
     */
    'vtk.js': 'vtkjs',
  });
  if (process.env.SENTRY_AUTH_TOKEN) {
    config
      .plugin('SentryPlugin')
      .use(SentryPlugin, [{
        authToken: process.env.SENTRY_AUTH_TOKEN,
        include: './dist',
        org: 'kitware-data',
        project: 'viame-web-client',
        release: process.env.VUE_APP_GIT_HASH
      }]);
  }
  config.module
  .rule('babel')
  .test(/\.js$/)
  .exclude.add(/node_modules/)
  .end()
  .use('babel-loader')
  .loader('babel-loader')
  .options({
    presets: ['@babel/preset-env']
  });
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
  productionSourceMap: true,
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
        copyright: 'Copyright © 2022 Kitware, Inc.',
        directories: {
          buildResources: 'platform/desktop/buildResources',
        },
        extraFiles: [
          {
            from: 'node_modules/ffmpeg-ffprobe-static',
            to: 'resources/ffmpeg-ffprobe-static',
            filter: ['ff*'],
          },
        ],
        // extraMetadata will be merged with package.json in args to electron-builder
        extraMetadata: {
          // https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/188
          // https://github.com/electron-userland/electron-builder/issues/2592
          main: 'background.js',
          name: 'DIVE-Desktop'
        },
        linux: {
          target: ['AppImage', 'tar.gz'],
          // eslint-disable-next-line no-template-curly-in-string
          artifactName: 'DIVE-Desktop-${version}.${ext}',
        },
        win: {
          target: ['portable', 'zip'],
          // eslint-disable-next-line no-template-curly-in-string
          artifactName: 'DIVE-Desktop-${version}.${ext}',
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
