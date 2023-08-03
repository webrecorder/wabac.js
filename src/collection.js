import { Rewriter } from "./rewrite/index.js";

import { getTS, getSecondsStr, notFound, parseSetCookie, handleAuthNeeded, REPLAY_TOP_FRAME_NAME } from "./utils.js";

import { ArchiveResponse } from "./response.js";

const DEFAULT_CSP = "default-src 'unsafe-eval' 'unsafe-inline' 'self' data: blob: mediastream: ws: wss: ; form-action 'self'";


// ===========================================================================
class Collection {
  constructor(opts, prefixes, defaultConfig = {}) {
    const { name, store, config } = opts;

    this.name = name;
    this.store = store;
    this.config = config;
    this.metadata = this.config.metadata ? this.config.metadata : {};

    const extraConfig = {...defaultConfig, ...this.config.extraConfig};

    this.injectScripts = extraConfig.injectScripts || [];
    this.noRewritePrefixes = extraConfig.noRewritePrefixes || null;

    this.noPostToGet = !!extraConfig.noPostToGet;

    this.convertPostToGet = !!extraConfig.convertPostToGet;

    this.coHeaders = extraConfig.coHeaders || false;

    this.csp = extraConfig.csp || DEFAULT_CSP;

    this.injectRelCanon = extraConfig.injectRelCanon || false;

    this.baseFramePrefix = extraConfig.baseUrlSourcePrefix;
    this.baseFrameUrl = extraConfig.baseUrl;
    this.baseFrameHashReplay = extraConfig.baseUrlHashReplay || false;

    this.liveRedirectOnNotFound = extraConfig.liveRedirectOnNotFound || false;

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
    // force timestamp for root coll
    //if (!requestTS && this.isRoot) {
    //requestTS = "2";
    //}
    let requestURL = request.url;
    let requestTS = request.timestamp;

    if (!request.mod) {
      return await this.makeTopFrame(requestURL, requestTS);
    }

    if (!this.noPostToGet) {
      requestURL = await request.convertPostToGet();
    }

    // exact or fuzzy match
    let response = null;

    let baseUrl = requestURL;
    
    try {
      if (requestURL.startsWith("srcdoc:")) {
        response = this.getSrcDocResponse(requestURL, requestURL.slice("srcdoc:".length));
      } else if (requestURL.startsWith("blob:")) {
        // the form of this url is now blob:<blob id>/<base url>
        // split on / to separate <blob id> and <base url>
        const inx = requestURL.indexOf("/");
        // blob url = blob:<origin>/<blob id>
        // skip blob prefix also
        const blobId = requestURL.slice(5, inx);
        const blobUrl = `blob:${self.location.origin}/${blobId}`;
        baseUrl = requestURL.slice(inx + 1);
        response = await this.getBlobResponse(blobUrl);
      } else if (requestURL === "about:blank") {
        response = await this.getSrcDocResponse(requestURL);
      } else if (requestURL === "__wb_module_decl.js") {
        response = await this.getWrappedModuleDecl(requestURL);
      } else {
        response = await this.getReplayResponse(request, event);
        requestURL = request.url;
        if (response && response.updateTS) {
          requestTS = response.updateTS;
        }
      }
    } catch (e) { 
      if (await handleAuthNeeded(e, this.config)) {
        return notFound(request, "<p style=\"margin: auto\">Please wait, this page will reload after authentication...</p>", 401);
      }
    }

    if (!response) {
      try {
        requestURL = decodeURIComponent(requestURL);
        requestURL += request.hash;
      } catch(e) {
        // ignore invalid URL
      }

      const msg = `
      <html>
      <body style="font-family: sans-serif">
      <h2>Archived Page Not Found</h2>
      <p>Sorry, this page was not found in this archive:</p>
      <p><code style="word-break: break-all; font-size: larger">${requestURL}</code></p>
      ${this.liveRedirectOnNotFound && request.mode === "navigate" ? `
      <p>Redirecting to live page now... (If this URL is a file download, the download should have started).</p>
      <script>
      window.top.location.href = "${requestURL}";
      </script>
      ` : `
      `}
      <p>
      <a target="_blank" href="${requestURL}">Click Here</a> to try to load the live page in a new tab (or to download the URL as a file).</p>
      </body>
      </html>
      `; 
      return notFound(request, msg);
    } else if (response instanceof Response) {
      // custom Response, not an ArchiveResponse, just return
      return response;
    }

    if (!response.noRW) {
      const basePrefix = this.prefix + (request.pageId ? `:${request.pageId}/` : "");
      const basePrefixTS = basePrefix + requestTS;

      const headInsertFunc = (url) => {
        let presetCookie = response.headers.get("x-wabac-preset-cookie") || "";
        const setCookie = response.headers.get("Set-Cookie");
        const topUrl = basePrefixTS + (requestTS ? "/" : "") + url;
        return this.makeHeadInsert(url, requestTS, response.date, topUrl, basePrefix, presetCookie, setCookie, response.isLive, request.referrer, response.extraOpts);
      };

      const workerInsertFunc = (text) => {
        return `
        (function() { self.importScripts('${this.staticPrefix}wombatWorkers.js');\
            new WBWombat({'prefix': '${basePrefixTS}/', 'prefixMod': '${basePrefixTS}wkrf_/', 'originalURL': '${requestURL}'});\
        })();` + text;
      };

      const mod = request.mod;

      const noRewrite = mod === "id_" || mod === "wkrf_";

      const prefix = basePrefixTS + mod + "/";

      const rewriteOpts = {
        baseUrl,
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

    if (range && (response.status === 200 || response.status === 206)) {
      response.setRange(range);
    }

    const deleteDisposition = (request.destination === "iframe" || request.destination === "document");
    return response.makeResponse(this.coHeaders, deleteDisposition);
  }

  getCanonRedirect(query) {
    let {url, timestamp, mod, referrer} = query;
    const schemeRel = url.startsWith("//");

    if (schemeRel) {
      let scheme = (referrer && referrer.indexOf("/http://") > 0) ? "http:" : "https:";
      url = scheme + url;
    }

    try {
      const parsed = new URL(url);
      if (parsed.href !== url) {
        if (parsed.pathname === "/") {
          let redirectUrl = this.prefix + timestamp + mod;
          if (timestamp || mod) {
            redirectUrl += "/";
          }
          redirectUrl += parsed.href;
          return Response.redirect(redirectUrl, 301);
        // if different due to canonical URL included, just update the URL
        } else if (!schemeRel && url.indexOf(":443") || url.indexOf(":80")) {
          query.url = parsed.href;
        }
      }
    } catch (e) {
      // ignore invalid URLs, no redirect
    }

    return null;
  }

  getWrappedModuleDecl() {
    const string = `
    var wrapObj = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
    if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }

    const window = wrapObj("window");
    const document = wrapObj("document");
    const location = wrapObj("location");
    const top = wrapObj("top");
    const parent = wrapObj("parent");
    const frames = wrapObj("frames");
    const opener = wrapObj("opener");
    const __self = wrapObj("self");
    const __globalThis = wrapObj("globalThis");

    export { window, document, location, top, parent, frames, opener, __self as self, __globalThis as globalThis };
    `;

    const payload = new TextEncoder().encode(string);

    const status = 200;
    const statusText = "OK";
    const headers = new Headers({"Content-Type": "application/javascript"});
    return new Response(payload, {headers, status, statusText});
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
    let response = this.getCanonRedirect(query);

    if (response) {
      return response;
    }

    const opts = {pageId: query.pageId};

    response = await this.store.getResource(query, this.prefix, event, opts);

    const {request, url} = query;

    // necessary as service worker seem to not be allowed to return a redirect in some circumstances (eg. in extension)
    if ((request.destination === "video" || request.destination === "audio") && request.mode !== "navigate") {
      while (response && (response.status >= 301 && response.status < 400)) {
        const newUrl = new URL(response.headers.get("location"), url);
        query.url = newUrl.href;
        console.log(`resolve redirect ${url} -> ${query.url}`);
        response = await this.store.getResource(query, this.prefix, event, opts);
      }
    }

    return response;
  }

  async makeTopFrame(url, requestTS) {
    let baseUrl = null;

    if (this.baseFrameUrl && !this.baseFramePrefix) {
      baseUrl = this.baseFrameUrl;
    } else if (!this.isRoot && this.config.sourceUrl) {
      baseUrl = this.baseFramePrefix || "./";
      baseUrl += `?source=${this.config.sourceUrl}`;
    }

    if (baseUrl) {
      if (this.baseFrameHashReplay) {
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
<iframe id="replay_iframe" name="${REPLAY_TOP_FRAME_NAME}" frameborder="0" seamless="seamless" scrolling="yes" class="wb_iframe" allow="autoplay; fullscreen"></iframe>
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
`;
    }

    let responseData = {
      "status": 200,
      "statusText": "OK",
      "headers": { "Content-Type": "text/html", "Content-Security-Policy": this.csp }
    };

    return new Response(content, responseData);
  }

  makeHeadInsert(url, requestTS, date, topUrl, prefix, presetCookie, setCookie, isLive, referrer, extraOpts) {
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

    if (setCookie) {
      presetCookie = parseSetCookie(setCookie, scheme) + ";" + presetCookie;
    }

    const pixelRatio = extraOpts && Number(extraOpts.pixelRatio) ? extraOpts.pixelRatio : 1;
    const storage = extraOpts && extraOpts.storage ? btoa(extraOpts.storage) : "";
    const presetCookieStr = presetCookie ? JSON.stringify(presetCookie) : "\"\"";
    return `
<!-- WB Insert -->
<style>
body {
  font-family: inherit;
  font-size: inherit;
}
</style>
${this.injectRelCanon ? `<link rel="canonical" href="${url}"/>` : ""}
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
  wbinfo.is_live = ${isLive ? "true" : "false"};
  wbinfo.coll = "${coll}";
  wbinfo.proxy_magic = "";
  wbinfo.static_prefix = "${this.staticPrefix}";
  wbinfo.enable_auto_fetch = true;
  wbinfo.presetCookie = ${presetCookieStr};
  wbinfo.storage = "${storage}";
  wbinfo.isSW = true;
  wbinfo.injectDocClose = true;
  wbinfo.pixel_ratio = ${pixelRatio};
  wbinfo.convert_post_to_get = ${this.convertPostToGet};
  wbinfo.target_frame = "${REPLAY_TOP_FRAME_NAME}";
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
  `;
  }
}

export { Collection };

