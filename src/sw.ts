import { SWReplay } from "./swmain";
import { WorkerLoader } from "./loaders";

// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let self: any;

if (self.registration) {
  // Service Worker Init
  self.sw = new SWReplay();
  console.log("sw init");
} else if (self.postMessage) {
  // Inited as Web Worker
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  new WorkerLoader(self);
  console.log("ww init");
}
