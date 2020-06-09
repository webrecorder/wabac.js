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
  },

  plugins: [
    new webpack.BannerPlugin('[name].js is part of Webrecorder project. Copyright (C) 2020, Webrecorder Software. Licensed under the Affero General Public License v3.')
  ],
};

