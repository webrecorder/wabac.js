import { getTS } from './utils.js';

class LiveCache {
  constructor(cacheName) {
    this.cacheName = cacheName;
    this.cache = null;
    self.caches.open(cacheName).then(cache => this.cache = cache);   
  }

  async match(request) {
    let response = await this.cache.match(request.url);

    if (response && response.headers.get("x-wabac-fuzzy-match") === "true") {
      response = await this.cache.match(response.headers.get("content-location"));
    }

    if (response) {
      response.date = new Date();
      response.timestamp = getTS(response.date.toISOString());
    }

    return response;
  }
}


class LiveAccess {
  async match(request) {
    const response = await fetch(request.url);
    response.date = new Date();
    response.timestamp = getTS(response.date.toISOString());
    return response;
  }
}

export { LiveCache, LiveAccess };
 
