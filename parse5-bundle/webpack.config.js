const path = require('path');

module.exports = {
  mode: 'production',
  entry: './index.js',
  devtool: 'inline-source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'parse5.js',
    libraryTarget: 'global',
    globalObject: 'self'
  }
};
