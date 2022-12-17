/*eslint-env node */

const path = require("path");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  mode: "production",
  target: "web",
  entry: {
    "wombat": "@webrecorder/wombat/src/wbWombat.js",
    "wombatWorkers": "@webrecorder/wombat/src/wombatWorkers.js",
    "sw": "./src/sw.js"
  },
  output: {
    path: path.join(__dirname, "dist"),
    filename: "[name].js",
    globalObject: "self",
    publicPath: "/dist/"
  },

  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
      }),
    ],
  },

  devServer: {
    compress: true,
    port: 9990,
    headers: {"Service-Worker-Allowed": "/"},
    open: false,
    //publicPath: "/dist/"
  },

  module: {
    rules: [
      {
        test: /(dist\/wombat.js|src\/wombatWorkers.js)$/i,
        use: "raw-loader",
      }
    ]
  },

  plugins: [
    new webpack.NormalModuleReplacementPlugin(
      /^node:*/,
      (resource) => {
        switch (resource.request) {
        case "node:stream":
          resource.request = "stream-browserify";
          break;
        }
      },
    ),

    new webpack.BannerPlugin(`[name].js is part of Webrecorder project. Copyright (C) 2020-${new Date().getFullYear()}, Webrecorder Software. Licensed under the Affero General Public License v3.`),
  ],
};

