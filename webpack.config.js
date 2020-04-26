const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: {
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
};

