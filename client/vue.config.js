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
  publicPath: process.env.VUE_APP_STATIC_PATH,
  chainWebpack: (config) => {
    config.output.strictModuleExceptionHandling(true);
    config.resolve.symlinks(false);
    config.resolve.alias.set('app', path.resolve(__dirname, 'app'));
    config.resolve.alias.set('vue-media-annotator', path.resolve(__dirname, 'src'));
  },
};
