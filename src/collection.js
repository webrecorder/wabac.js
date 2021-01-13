"use strict";

import { Rewriter } from './rewrite';

import { getTS, getSecondsStr, notFound, AuthNeededError } from './utils.js';

import { ArchiveResponse } from './response';

const DEFAULT_CSP = "default-src 'unsafe-eval' 'unsafe-inline' 'self' data: blob: mediastream: ws: wss: ; form-action 'self'";

const REPLAY_REGEX = /^(\d*)([a-z]+_|[$][a-z0-9:.-]+)?(?:\/|\||%7C|%7c)(.+)/;


class Collection {
  constructor(opts, prefixes) {
    const { name, store, config } = opts;

    this.name = name;
    this.store = store;
    this.config = config;
    this.metadata = this.config.metadata ? this.config.metadata : {};

    const extraConfig = this.config.extraConfig || {};

    this.injectScripts = extraConfig.injectScripts || [];
    this.noRewritePrefixes = extraConfig.noRewritePrefixes || null;

    this.coHeaders = extraConfig.coHeaders || false;

    this.csp = extraConfig.csp || DEFAULT_CSP;

    this.injectRelCanon = extraConfig.injectRelCanon || false;

    this.rootPrefix = prefixes.root || prefixes.main;

    this.prefix = prefixes.main;

    // support root collection hashtag nav
    if (this.config.root) {
      this.isRoot = true;
    } else {
      this.prefix += this.name + "/";
      this.isRoot = false;
    }

    this.staticPrefix = prefixes.static;
  }

  async handleRequest(request, event) {
    let wbUrlStr = request.url;

    if (wbUrlStr.startsWith(this.prefix)) {
      wbUrlStr = wbUrlStr.substring(this.prefix.length);
    } else {
      return null;
    }

    const responseOpts = {
      "status": 200,
      "statusText": "OK",
      "headers": { "Content-Type": "text/html" }
    };

    let content = null;

    // pageList
    if (wbUrlStr == "") {
      content = '<html><body><h2>Available Pages</h2><ul>'

      const pages = await this.store.getAllPages();

      for (const page of pages) {
        let href = this.prefix;
        if (page.date) {
          href += page.date + "/";
        }
        href += page.url;
        content += `<li><a href="${href}">${page.url}</a></li>`
      }

      content += '</ul></body></html>'

      return new Response(content, responseOpts);
    }

    const wbUrl = REPLAY_REGEX.exec(wbUrlStr);
    let requestTS = '';
    let requestURL = '';
    let mod = '';

    if (!wbUrl && (wbUrlStr.startsWith("https:") || wbUrlStr.startsWith("http:") || wbUrlStr.startsWith("blob:"))) {
      requestURL = wbUrlStr;
    } else if (!wbUrl && this.isRoot) {
      requestURL = "https://" + wbUrlStr;
    } else if (!wbUrl) {
      return notFound(request, `Replay URL ${wbUrlStr} not found`);
    } else {
      requestTS = wbUrl[1];
      mod = wbUrl[2];
      requestURL = wbUrl[3];
    }

    // force timestamp for root coll
    //if (!requestTS && this.isRoot) {
      //requestTS = "2";
    //}

    if (!mod) {
      return await this.makeTopFrame(requestURL, requestTS);
    }

    const hash = requestURL.indexOf("#");
    if (hash > 0) {
      requestURL = requestURL.substring(0, hash);
    }

    // exact or fuzzy match
    let response = null;
    
    try {
      if (requestURL.startsWith("srcdoc:")) {
        response = this.getSrcDocResponse(requestURL, requestURL.slice("srcdoc:".length));
      } else if (requestURL.startsWith("blob:")) {
        response = await this.getBlobResponse(requestURL);
      } else if (requestURL === "about:blank") {
        response = await this.getSrcDocResponse(requestURL);
      } else {
        const query = {
          url: requestURL,
          method: request.method,
          timestamp: requestTS,
          mod,
          request
        };

        response = await this.getReplayResponse(query, event);
      }
    } catch (e) {
      if (e instanceof AuthNeededError) {
        //const client = await self.clients.get(event.clientId || event.resultingClientId);
        const clients = await self.clients.matchAll({ "type": "window" });
        for (const client of clients) {
          const url = new URL(client.url);
          if (url.searchParams.get("source") === this.config.sourceUrl) {
            client.postMessage({
              source: this.config.sourceUrl,
              coll: this.name,
              type: "authneeded",
              fileHandle: e.info && e.info.fileHandle,
            });
          }
        } 

        return notFound(request, `<p style="margin: auto">Please wait, this page will reload after authentication...</p>`, 401);
      }
    }

    if (!response) {
      const msg = `
      <p>Sorry, the URL <b>${requestURL}</b> is not in this archive.</p>
      <p><a target="_blank" href="${requestURL}">Try Live Version?</a></p>`;
      return notFound(request, msg);
    } else if (response instanceof Response) {
      // custom Response, not an ArchiveResponse, just return
      return response;
    }

    if (!response.noRW) {
      const headInsertFunc = (url) => {
        const presetCookie = response.headers.get("x-wabac-preset-cookie");
        return this.makeHeadInsert(url, requestTS, response.date, presetCookie, response.isLive, request.referrer);
      };

      const workerInsertFunc = (text) => {
        return `
        (function() { self.importScripts('${this.staticPrefix}wombatWorkers.js');\
            new WBWombat({'prefix': '${this.prefix + requestTS}/', 'prefixMod': '${this.prefix + requestTS}wkrf_/', 'originalURL': '${requestURL}'});\
        })();` + text;
      };

      const noRewrite = mod === "id_" || mod === "wkrf_";
      const prefix = this.prefix + requestTS + mod + "/";

      const rewriteOpts = {
        baseUrl: requestURL,
        responseUrl: response.url,
        prefix,
        headInsertFunc,
        workerInsertFunc,
        urlRewrite: !noRewrite,
        contentRewrite: !noRewrite,
        decode: this.config.decode
      };

      const rewriter = new Rewriter(rewriteOpts);

      response = await rewriter.rewrite(response, request);

      if (mod !== "id_") {
        response.headers.append("Content-Security-Policy", this.csp);
      }
    }

    const range = request.headers.get("range");

    if (range && response.status === 200) {
      response.setRange(range);
    }

    return response.makeResponse(this.coHeaders);
  }

  checkSlash({url, timestamp, mod}) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname === "/" && parsed.href !== url) {
        let redirectUrl = this.prefix + timestamp + mod;
        if (timestamp || mod) {
          redirectUrl += "/";
        }
        redirectUrl += parsed.href;
        return Response.redirect(redirectUrl, 301);
      }
    } catch (e) {}

    return null;
  }

  getSrcDocResponse(url, base64str) {
    const string = base64str ? decodeURIComponent(atob(base64str)) : "<!DOCTYPE html><html><head></head><body></body></html>";
    const payload = new TextEncoder().encode(string);

    const status = 200;
    const statusText = "OK";
    const headers = new Headers({"Content-Type": "text/html"});
    const date = new Date();
    return new ArchiveResponse({payload, status, statusText, headers, url, date});
  }

  async getBlobResponse(url) {
    const resp = await fetch(url);

    const status = resp.status;
    const statusText = resp.statusText;
    const headers = new Headers(resp.headers);
    if (headers.get("content-type") === "application/xhtml+xml") {
      headers.set("content-type", "text/html");
    }
    const date = new Date();
    const payload = new Uint8Array(await resp.arrayBuffer());

    return new ArchiveResponse({payload, status, statusText, headers, url, date});
  }

  async getReplayResponse(query, event) {
    let response = this.checkSlash(query);

    if (response) {
      return response;
    }

    response = await this.store.getResource(query, this.prefix, event);

    const {request, url} = query;

    // necessary as service worker seem to not be allowed to return a redirect in some circumstances (eg. in extension)
    if ((request.destination === "video" || request.destination === "audio") && request.mode !== "navigate") {
      while (response && (response.status >= 301 && response.status < 400)) {
        const newUrl = new URL(response.headers.get("location"), url);
        query.url = newUrl.href;
        console.log(`resolve redirect ${url} -> ${query.url}`);
        response = await this.store.getResource(query, this.prefix, event);
      }
    }

    return response;
  }

  async makeTopFrame(url, requestTS, isLive) {
    let baseUrl = null;

    if (this.config.extraConfig && this.config.extraConfig.baseUrl) {
      baseUrl = this.config.extraConfig.baseUrl;
    } else if (!this.isRoot && this.config.sourceUrl) {
      baseUrl = `/?source=${this.config.sourceUrl}`;
    }

    if (baseUrl) {
      if (this.config.extraConfig.baseUrlHashReplay) {
        baseUrl += `#${requestTS}/${url}`;
      } else {
        const locParams = new URLSearchParams({url, ts: requestTS, view: "replay"});
        baseUrl += "#" + locParams.toString();
      }

      return Response.redirect(baseUrl);
    }

    let content = null;

    if (this.config.topTemplateUrl) {
      const resp = await fetch(this.config.topTemplateUrl);
      const topTemplate = await resp.text();
      content = topTemplate.replace("$URL", url).replace("$TS", requestTS).replace("$PREFIX", this.prefix);
    } else {
      content = `
<!DOCTYPE html>
<html>
<head>
<style>
html, body
{
  height: 100%;
  margin: 0px;
  padding: 0px;
  border: 0px;
  overflow: hidden;
}

</style>
<script src='${this.staticPrefix}wb_frame.js'> </script>

<script>
window.home = "${this.rootPrefix}";
</script>

<script src='${this.staticPrefix}default_banner.js'> </script>
<link rel='stylesheet' href='${this.staticPrefix}default_banner.css'/>

</head>
<body style="margin: 0px; padding: 0px;">
<div id="wb_iframe_div">
<iframe id="replay_iframe" frameborder="0" seamless="seamless" scrolling="yes" class="wb_iframe" allow="autoplay; fullscreen"></iframe>
</div>
<script>
  var cframe = new ContentFrame({"url": "${url}",
                                 "app_prefix": "${this.prefix}",
                                 "content_prefix": "${this.prefix}",
                                 "request_ts": "${requestTS}",
                                 "iframe": "#replay_iframe"});

</script>
</body>
</html>
`
    }

    let responseData = {
      "status": 200,
      "statusText": "OK",
      "headers": { "Content-Type": "text/html", "Content-Security-Policy": this.csp }
    };

    return new Response(content, responseData);
  }

  makeHeadInsert(url, requestTS, date, presetCookie, isLive, referrer) {
    const prefix = this.prefix;
    const topUrl = prefix + requestTS + (requestTS ? "/" : "") + url;
    const coll = this.name;

    const seconds = getSecondsStr(date);

    const timestamp = getTS(date.toISOString());

    const urlParsed = new URL(url);

    let scheme;

    // protocol scheme (for relative urls): if not http/https, try to get actual protocol from referrer
    if (urlParsed.protocol !== "https:" && urlParsed.protocol !== "http:") {
      scheme = (referrer && referrer.indexOf("/http://") > 0) ? "http" : "https";
    } else {
      scheme = urlParsed.protocol.slice(0, -1);
    }

    const presetCookieStr = presetCookie ? JSON.stringify(presetCookie) : '""';
    return `
<!-- WB Insert -->
<style>
body {
  font-family: inherit;
  font-size: inherit;
}
</style>
${this.injectRelCanon ? `<link rel="canonical" href="${url}"/>` : ``}
<script>
  wbinfo = {};
  wbinfo.top_url = "${topUrl}";
  // Fast Top-Frame Redirect
  if (window == window.top && wbinfo.top_url) {
    var loc = window.location.href.replace(window.location.hash, "");
    loc = decodeURI(loc);

    if (loc != decodeURI(wbinfo.top_url)) {
        window.location.href = wbinfo.top_url + window.location.hash;
    }
  }
  wbinfo.url = "${url}";
  wbinfo.timestamp = "${timestamp}";
  wbinfo.request_ts = "${requestTS}";
  wbinfo.prefix = decodeURI("${prefix}");
  wbinfo.mod = "mp_";
  wbinfo.is_framed = true;
  wbinfo.is_live = ${isLive ? 'true' : 'false'};
  wbinfo.coll = "${coll}";
  wbinfo.proxy_magic = "";
  wbinfo.static_prefix = "${this.staticPrefix}";
  wbinfo.enable_auto_fetch = true;
  wbinfo.presetCookie = ${presetCookieStr};
  wbinfo.isSW = true;
</script>
<script src='${this.staticPrefix}wombat.js'> </script>
<script>
  wbinfo.wombat_ts = "${isLive ? timestamp : requestTS}";
  wbinfo.wombat_sec = "${seconds}";
  wbinfo.wombat_scheme = "${scheme}";
  wbinfo.wombat_host = "${urlParsed.host}";

  ${this.noRewritePrefixes ? `
  wbinfo.wombat_opts = {"no_rewrite_prefixes": ${JSON.stringify(this.noRewritePrefixes)}}` : `
  wbinfo.wombat_opts = {}
  `}

  if (window && window._WBWombatInit) {
    window._WBWombatInit(wbinfo);
  }
</script>
${this.injectScripts.map((script) => `<script src='${script}'> </script>`).join("")}
  `
  }
}

export { Collection };

