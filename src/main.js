
if (self.registration) {
  //import { SWReplay } from './swmain.js';
  const SWReplay = require('./swmain.js').SWReplay;
  self.sw = new SWReplay();
  console.log('sw init');

} else if (self.document) {
  const embedInit = require('./pageembeds.js').embedInit;

  if (!self.__wabacEmbeds) {
    self.__wabacEmbeds = embedInit();
  }
}

