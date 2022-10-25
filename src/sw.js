import { SWReplay } from "./swmain.js";
import { WorkerLoader } from "./loaders.js";

if (self.registration) {
// Service Worker Init
  self.sw = new SWReplay();
  console.log("sw init");
} else if (self.postMessage) {
// Inited as Web Worker
  new WorkerLoader(self);
  console.log("ww init");
}


