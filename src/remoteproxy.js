import { tsToDate } from './utils.js';

import { ArchiveResponse } from './response';
import { fuzzyMatcher } from './fuzzymatcher.js';

import { WARCParser, AsyncIterReader } from 'warcio';


const EXTRACT_TS = /(?:([\d]+)[^\/]*\/)?(http.*)/;


// ===========================================================================
class RemoteWARCProxy {
  constructor(config) {
    this.sourceUrl = config.sourceUrl;
    this.type = config.extraConfig && config.extraConfig.sourceType || "kiwix";
    this.notFoundPageUrl = config.extraConfig && config.extraConfig.notFoundPageUrl;
  }

  async getAllPages() {
    return [];
  }

  async getResource(request, prefix, event) {
    const { url, headers } = resolveRequestParams(request, prefix);
    let reqHeaders = headers;

    if (this.type === "kiwix") {
      let headersData = await this.resolveHeaders(url);

      if (!headersData) {
        const newUrl = fuzzyMatcher.getFuzzyCanonWithArgs(url);
        if (newUrl !== url) {
          headersData = await this.resolveHeaders(newUrl);
        }
      }

      if (!headersData) {

        // use custom error page for navigate events
        if (this.notFoundPageUrl && request.request.mode === "navigate") {
          const resp = await fetch(this.notFoundPageUrl);
          // load 'not found' page template
          if (resp.status === 200) {
            const headers = {"Content-Type": "text/html"};
            const text = await resp.text();
            return new Response(text.replace("$URL", url), {status: 404, headers});
          }
        }

        return null;
      }

      let { headers, encodedUrl, date, status, statusText, hasPayload } = headersData;

      if (reqHeaders.has("Range")) {
        const range = reqHeaders.get("Range");
        // ensure uppercase range to avoid bug in kiwix-serve
        reqHeaders = {"Range": range};
      }

      let payload = null;

      let response = null;

      if (hasPayload) {
        response = await fetch(this.sourceUrl + "A/" + encodedUrl, {headers: reqHeaders});

        if (response.body) {
          payload = new AsyncIterReader(response.body.getReader(), false);
        }

        if (response.status === 206) {
          status = 206;
          statusText = "Partial Content";
          headers.set("Content-Length", response.headers.get("Content-Length"));
          headers.set("Content-Range", response.headers.get("Content-Range"));
          headers.set("Accept-Ranges", "bytes");
        }
      }

      if (!payload) {
        payload = new Uint8Array([]);
      }

      if (!date) {
        date = new Date();
      }

      if (!headers) {
        headers = new Headers();
      }

      const isLive = false;
      const noRW = false;

      return new ArchiveResponse({payload, status, statusText, headers, url, date, noRW, isLive});
    }
  }

  async resolveHeaders(url) {
    const urlNoScheme = url.slice(url.indexOf("//") + 2);

    // need to escape utf-8, then % encode the entire string
    let encodedUrl = encodeURI(urlNoScheme);
    encodedUrl = encodeURIComponent(urlNoScheme);

    let headersResp = await fetch(this.sourceUrl + "H/" + encodedUrl);

    if (headersResp.status !== 200) {
      return null;
    }

    let headers = null;
    let date = null;
    let status = null;
    let statusText = null;
    let hasPayload = false;

    try {
      const record = await WARCParser.parse(headersResp.body);

      if (record.warcType === "revisit") {
        const warcRevisitTarget = record.warcHeaders.headers.get("WARC-Refers-To-Target-URI");
        if (warcRevisitTarget && warcRevisitTarget !== url) {
          return await this.resolveHeaders(warcRevisitTarget);
        }
      }
      
      date = new Date(record.warcDate);

      if (record.httpHeaders) {
        headers = record.httpHeaders.headers;
        status = Number(record.httpHeaders.statusCode);
        statusText = record.httpHeaders.statusText;
        hasPayload = record.httpHeaders.headers.get("Content-Length") !== "0";
      } else if (record.warcType === "resource") {
        headers = new Headers();
        headers.set("Content-Type", record.warcContentType);
        headers.set("Content-Length", record.warcContentLength);
        status = 200;
        statusText = "OK";
        hasPayload = record.warcContentLength > 0;
      }

      if (!status) {
        status = 200;
      }

    } catch (e) {
      console.warn(e);
      console.warn("Ignoring headers, error parsing headers response for: " + url);
    }

    return {encodedUrl, headers, date, status, statusText, hasPayload};
  }
}


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

    const { headers, credentials, url} = resolveRequestParams(request, prefix);

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
               credentials,
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


function resolveRequestParams(request, prefix, isLive = true) {
  let headers;
  let referrer;
  let credentials;

  if (isLive) {
    headers = new Headers(request.request.headers);
    referrer = request.request.referrer;
    const inx = referrer.indexOf("/http", prefix.length - 1);
    if (inx > 0) {
      referrer = referrer.slice(inx + 1);
      headers.set("X-Proxy-Referer", referrer);
    }
    credentials = request.request.credentials;
  } else {
    headers = new Headers();
    credentials = 'omit';
  }

  let url = request.url;

  if (url.startsWith("//")) {
    try {
      url = new URL(referrer).protocol + url;
    } catch(e) {
      url = "https:" + url;
    }
  }

  return {referrer, headers, credentials, url};
}


export { RemoteWARCProxy, RemoteProxySource, LiveAccess };
