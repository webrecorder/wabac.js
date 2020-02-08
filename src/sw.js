
if (self.registration) {
  //import { SWReplay } from './swmain.js';
  const SWReplay = require('./swmain.js').SWReplay;
  self.sw = new SWReplay();
  console.log('sw init');
} 
