const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: {
    'wombat': 'wombat/src/wbWombat.js',
    'wombatWorkers': 'wombat/src/wombatWorkers.js',
    'sw': './src/sw.js',
  },
  output: {
    path: path.join(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'global',
    globalObject: 'self',
    publicPath: '/dist/'
  },

  devServer: {
    compress: true,
    port: 9990,
    headers: {'Service-Worker-Allowed': '/'},
    open: false,
    publicPath: '/dist/'
  },

  module: {
      rules: [
      {
        test: /(dist\/wombat.js|src\/wombatWorkers.js)$/i,
        loaders: 'raw-loader',
      }
      ]
  }
};

