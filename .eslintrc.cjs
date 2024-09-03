module.exports = {
  env: {
    browser: true,
    es6: true,
  },
  extends: "eslint:recommended",
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: "module",
  },
  globals: {
    globalThis: false, //not writable
  },
  rules: {
    "no-restricted-globals": [2, "event", "window"],
    indent: ["error", 2],
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "double"],
    semi: ["error", "always"],
  },
};
