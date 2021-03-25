"use strict";

if (self.registration) {
// Service Worker Init
  const { SWReplay } = require("./swmain.js"); // eslint-disable-line
  self.sw = new SWReplay();
  console.log("sw init");
} else if (self.postMessage) {
// Inited as Web Worker
  const { WorkerLoader } = require("./loaders"); // eslint-disable-line
  new WorkerLoader(self);
  console.log("ww init");
}


