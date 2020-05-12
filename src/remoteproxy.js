import { tsToDate } from './utils.js';

import { ArchiveResponse } from './response';


const EXTRACT_TS = /(?:([\d]+)[^\/]*\/)?(http.*)/;


// ===========================================================================
class RemoteProxySource {

  constructor(remoteInfo) {
    this.replayPrefix = remoteInfo.replayPrefix;
    this.idMod = (remoteInfo.idMod !== undefined ? remoteInfo.idMod : "id_");
    this.redirMod = (remoteInfo.redirMod !== undefined ? remoteInfo.redirMod : "mp_");

    this.redirectMode = (this.idMod === this.redirMod) ? "follow" : "manual";
  }

  async getAllPages() {
    return [];
  }

  getUrl(request, mod) {
    let url = this.replayPrefix;
    if (mod || request.timestamp) {
      url += request.timestamp + mod + "/";
    }
    return url + request.url;
  }

  async getResource(request, prefix, event) {
    let response = await fetch(this.getUrl(request, this.idMod),
      {
        credentials: 'same-origin',
        redirect: this.redirectMode,
        mode: 'cors'
      });

    if (response.status >= 400 && !response.headers.get("memento-datetime")) {
      return null;
    }

    const redirRes  = await this.getRedirect(request, response, prefix);

    let timestamp = null;
    let noRW = false;

    if (redirRes) {
      response = Response.redirect(redirRes.path, 307);
      noRW = true;
      timestamp = redirRes.timestamp;
    } else {
      timestamp = request.timestamp;
    }

    // todo: get url from Link: header?
    const url = request.url;

    const date = (timestamp ? tsToDate(timestamp) : new Date());

    return ArchiveResponse.fromResponse({url, response, date, noRW});
  }

  async getRedirect(request, response, prefix) {
    // handle redirects by following
    if (response.type === "opaqueredirect") {
      response = await fetch(this.getUrl(request, this.redirMod),
        {
          credentials: 'same-origin',
          redirect: 'follow',
          mode: 'cors'
        });
    } else if (!response.redirected) {
      return null;
    }

    const inx = response.url.indexOf(this.replayPrefix) + this.replayPrefix.length;

    const redirOrig = response.url.slice(inx);

    const m = redirOrig.match(EXTRACT_TS);

    if (m) {
      return {timestamp: m[1],
              path: prefix + m[1] + "mp_/" + m[2]}
    } else {
      return {path: prefix + redirOrig};
    }
  }
}


// ===========================================================================
class LiveAccess {
  constructor(prefix, proxyPathOnly = false, isLive = true) {
    this.prefix = prefix || "";
    this.proxyPathOnly = proxyPathOnly;
    this.isLive = isLive;
  }

  async getAllPages() {
    return [];
  }

  async getResource(request, prefix, event) {

    const headers = new Headers(request.request.headers);
    let referrer = request.request.referrer;
    const inx = referrer.indexOf("/http", prefix.length - 1);
    if (inx > 0) {
      referrer = referrer.slice(inx + 1);
      headers.set("X-Proxy-Referer", referrer);
    }

    let url = request.url;

    if (url.startsWith("//")) {
      try {
        url = new URL(referrer).protocol + url;
      } catch(e) {
        url = "https:" + url;
      }
    }

    let fetchUrl;

    if (this.proxyPathOnly) {
      const parsedUrl = new URL(url);
      fetchUrl = this.prefix + parsedUrl.pathname + parsedUrl.search;
    } else {
      fetchUrl = this.prefix + url;
    }

    const response = await fetch(fetchUrl,
              {method: request.request.method,
               body: request.request.body,
               headers,
               credentials: request.request.credentials,
               mode: 'cors',
               redirect: 'follow'
              });

    return ArchiveResponse.fromResponse({url,
            response,
            date: new Date(),
            noRW: false,
            isLive: this.isLive,
           });
  }
}


export { RemoteProxySource, LiveAccess };
