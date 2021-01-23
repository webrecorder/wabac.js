const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: {
    'wombat': '@webrecorder/wombat/src/wbWombat.js',
    'wombatWorkers': '@webrecorder/wombat/src/wombatWorkers.js',
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
    new webpack.BannerPlugin('[name].js is part of Webrecorder project. Copyright (C) 2020=2021, Webrecorder Software. Licensed under the Affero General Public License v3.'),
    new webpack.DefinePlugin({
      __IPFS_CORE_URL__: JSON.stringify("https://cdn.jsdelivr.net/npm/ipfs-core@0.4.2/dist/index.min.js")
    })
  ],
};

