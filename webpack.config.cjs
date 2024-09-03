/*eslint-env node */

const path = require("path");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const package_json = require("./package.json");
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");

module.exports = {
  mode: "production",
  target: "web",
  entry: {
    //"wombat": "@webrecorder/wombat/src/wbWombat.js",
    //"wombatWorkers": "@webrecorder/wombat/src/wombatWorkers.js",
    sw: "./src/sw.ts",
  },
  output: {
    path: path.join(__dirname, "dist"),
    filename: "[name].js",
    globalObject: "self",
    publicPath: "/dist/",
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
    headers: { "Service-Worker-Allowed": "/" },
    open: false,
    //publicPath: "/dist/"
  },

  resolve: {
    extensions: [".ts", ".js"],
    plugins: [new TsconfigPathsPlugin()],
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        include: path.resolve(__dirname, "src"),
        options: {
          onlyCompileBundledFiles: false,
        },
      },
      {
        test: /(wombat.txt|wombatWorkers.txt)$/i,
        use: "raw-loader",
      },
    ],
  },

  plugins: [
    new webpack.NormalModuleReplacementPlugin(/^node:*/, (resource) => {
      switch (resource.request) {
        case "node:stream":
          resource.request = "stream-browserify";
          break;
      }
    }),

    new webpack.ProvidePlugin({
      process: "process/browser",
    }),

    new webpack.BannerPlugin(
      `[name].js (wabac.js ${package_json.version}) is part of Webrecorder project. Copyright (C) 2020-${new Date().getFullYear()}, Webrecorder Software. Licensed under the Affero General Public License v3.`,
    ),

    //new CopyPlugin({
    //  patterns: [{ from: "node_modules/@webrecorder/wombat/src/wombatWorkers.js", to: "src/wombat/" }],
    //}),
  ],
};
