
import { Bundle } from 'wbn';

import { getTS, makeNewResponse } from './utils.js';

class WebBundleCache {
  constructor(buffer) {
    this.bundle = new Bundle(Buffer.from(buffer));
    this.pageList = [];

    this.pageList.push({ "timestamp": "",
                         "title": this.bundle.primaryURL,
                         "url": this.bundle.primaryURL
                       });
  }

  async match(request) {
    let response = null;
    try {
      response = this.bundle.getResponse(request.url);
    } catch (e) {
      return null;
    }
    
    if (!response) {
      return null;
    }

    const init = {
      "status": response.status,
      "statusText": "OK",
      "headers": response.headers
    }

    const date = new Date();
    const timestamp = getTS(date.toISOString());

    return makeNewResponse(response.body, init, timestamp, date);
  }
}

export { WebBundleCache };
 
