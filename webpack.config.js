const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: {
    'sw': './src/main.js',
    'page': './page-build.js'
  },
  //devtool: 'inline-source-map',
  output: {
    path: __dirname,
    filename: '[name].js',
    libraryTarget: 'global',
    globalObject: 'self'
  },

  plugins: [
    new webpack.IgnorePlugin(/fs|untildify/),
  ],

  devServer: {
    compress: true,
    port: 9990,
  }
};
