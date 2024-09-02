import { SWReplay } from "./swmain";
import { WorkerLoader } from "./loaders";

declare let self: any;

if (self.registration) {
// Service Worker Init
  self.sw = new SWReplay();
  console.log("sw init");
} else if (self.postMessage) {
// Inited as Web Worker
  new WorkerLoader(self);
  console.log("ww init");
}


