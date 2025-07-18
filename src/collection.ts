import { ProxyRewriter, Rewriter, TO_MP } from "./rewrite";
import { DISABLE_MEDIASOURCE_SCRIPT } from "./rewrite/dsruleset";

import {
  getTS,
  getSecondsStr,
  parseSetCookie,
  handleAuthNeeded,
  REPLAY_TOP_FRAME_NAME,
  getCSP,
  addProxyAllowPaths,
} from "./utils";

import { ArchiveResponse } from "./response";

import { getAdBlockCSSResponse } from "./adblockcss";
import { notFound, notFoundByTypeResponse } from "./notfound";
import { type ArchiveDB } from "./archivedb";
import { type ArchiveRequest } from "./request";
import { type CollMetadata, type CollConfig, type ExtraConfig } from "./types";

export type Prefixes = {
  static: string;
  root: string;
  main: string;
  proxy: string;
  api: string;
};

// ===========================================================================
export class Collection {
  name: string;
  store: ArchiveDB;

  config: CollConfig;
  metadata: CollMetadata;

  injectScripts: string[];

  noRewritePrefixes: string[] | null;

  noPostToGet: boolean;
  convertPostToGet: boolean;

  coHeaders: boolean;
  csp: string;
  injectRelCanon: boolean;

  baseFramePrefix: string;
  baseFrameUrl: string;
  baseFrameHashReplay = false;
  baseFrameAppendReplay = false;

  liveRedirectOnNotFound = false;

  rootPrefix: string;
  isRoot: boolean;

  prefix: string;

  adblockUrl?: string;

  staticPrefix: string;
  proxyPrefix: string;

  proxyBannerUrl = "";

  constructor(
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: Record<string, any>,
    prefixes: Prefixes,
    defaultConfig = {},
  ) {
    const { name, store, config } = opts;

    this.name = name;
    this.store = store;
    this.config = config;
    this.metadata = this.config.metadata ? this.config.metadata : {};

    const extraConfig: ExtraConfig = {
      ...defaultConfig,
      ...this.config.extraConfig,
    };

    this.injectScripts = extraConfig.injectScripts || [];
    this.noRewritePrefixes = extraConfig.noRewritePrefixes || null;

    this.noPostToGet = !!extraConfig.noPostToGet;

    this.convertPostToGet = !!extraConfig.convertPostToGet;

    this.coHeaders = extraConfig.coHeaders || false;

    this.injectRelCanon = extraConfig.injectRelCanon || false;

    this.baseFramePrefix = extraConfig.baseUrlSourcePrefix!;
    this.baseFrameUrl = extraConfig.baseUrl!;
    this.baseFrameHashReplay = extraConfig.baseUrlHashReplay || false;
    this.baseFrameAppendReplay = extraConfig.baseUrlAppendReplay || false;

    this.liveRedirectOnNotFound = extraConfig.liveRedirectOnNotFound || false;

    this.rootPrefix = prefixes.root || prefixes.main;

    this.adblockUrl = extraConfig.adblockUrl;

    this.prefix = prefixes.main;

    this.proxyBannerUrl = extraConfig.proxyBannerUrl || "";
    if (this.proxyBannerUrl) {
      addProxyAllowPaths([this.proxyBannerUrl]);
    }

    // support root collection hashtag nav
    if (this.config.root) {
      this.isRoot = true;
      this.csp = extraConfig.csp || getCSP();
    } else {
      this.prefix += this.name + "/";
      this.isRoot = false;
      this.csp = extraConfig.csp || getCSP() + this.name + "/";
    }

    this.staticPrefix = prefixes.static;
    this.proxyPrefix = prefixes.proxy;
  }

  async handleRequest(
    request: ArchiveRequest,
    event: FetchEvent,
  ): Promise<Response> {
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
    let response: ArchiveResponse | Response | null = null;

    let baseUrl = requestURL;

    try {
      if (requestURL.startsWith("srcdoc:")) {
        response = this.getSrcDocResponse(
          requestURL,
          requestURL.slice("srcdoc:".length),
        );
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
        response = await this.getWrappedModuleDecl();
      } else if (this.adblockUrl && requestURL.startsWith("adblock:")) {
        response = await getAdBlockCSSResponse(
          requestURL.slice("adblock:".length),
          this.adblockUrl,
        );
      } else {
        response = await this.getReplayResponse(request, event);
        requestURL = request.url;
        if (
          response &&
          response instanceof ArchiveResponse &&
          response.updateTS
        ) {
          requestTS = response.updateTS;
        }
      }
    } catch (e) {
      if (await handleAuthNeeded(e, this.config)) {
        return notFound(
          request.request,
          '<p style="margin: auto">Please wait, this page will reload after authentication...</p>',
          401,
        );
      }
    }

    if (!response) {
      try {
        requestURL = decodeURIComponent(requestURL);
        requestURL += request.hash;
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // ignore invalid URL
      }

      return notFoundByTypeResponse(
        request.request,
        requestURL,
        requestTS,
        this.liveRedirectOnNotFound,
      );
    } else if (response instanceof Response) {
      // custom Response, not an ArchiveResponse, just return
      return response;
    }

    if (!response.noRW) {
      if (!request.isProxyOrigin) {
        response = await this.fullRewrite(
          request,
          response,
          baseUrl,
          requestURL,
          requestTS,
        );
      } else {
        response = await this.proxyRewrite(
          request,
          response,
          baseUrl,
          requestTS,
        );
      }
    }

    const range = request.headers.get("range");

    if (range && (response.status === 200 || response.status === 206)) {
      response.setRange(range);
    }

    const deleteDisposition =
      request.destination === "iframe" || request.destination === "document";
    return response.makeResponse(this.coHeaders, deleteDisposition);
  }

  async fullRewrite(
    request: ArchiveRequest,
    response: ArchiveResponse,
    baseUrl: string,
    requestURL: string,
    requestTS: string,
  ) {
    const basePrefix =
      this.prefix + (request.pageId ? `:${request.pageId}/` : "");
    const basePrefixTS = basePrefix + requestTS;
    const arResponse = response;

    const headInsertFunc = (url: string) => {
      const topUrl = basePrefixTS + (requestTS ? "/" : "") + url;

      return this.makeHeadInsert(
        url,
        requestTS,
        topUrl,
        basePrefix,
        arResponse,
        request.referrer,
      );
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerInsertFunc = (text: string, opts?: any) => {
      if (opts?.isModule) {
        return text;
      }
      return (
        `
      (function() { self.importScripts('${this.staticPrefix}wombatWorkers.js');\
          new WBWombat({'prefix': '${basePrefixTS}/', 'prefixMod': '${basePrefixTS}wkrf_/', 'originalURL': '${requestURL}'});\
      })();` + text
      );
    };

    const mod = TO_MP.includes(request.mod) ? "mp_" : request.mod;

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
      decode: this.config.decode,
    };

    const rewriter = new Rewriter(rewriteOpts);

    response = await rewriter.rewrite(response, request);

    response.headers.set("Content-Security-Policy", this.csp);

    return response;
  }

  async proxyRewrite(
    request: ArchiveRequest,
    response: ArchiveResponse,
    baseUrl: string,
    requestTS: string,
  ) {
    const basePrefix =
      this.prefix + (request.pageId ? `:${request.pageId}/` : "");

    const timestamp = response.date.toISOString();

    // default to requestTS if any, otherwise us actual ts for iframe rw
    const basePrefixTS = basePrefix + (requestTS || getTS(timestamp));

    const headInsertFunc = (url: string) => {
      const presetCookieStr = this.getCookiePreset(
        response,
        request.proxyScheme,
      );

      const seconds = getSecondsStr(response.date);

      const extraOpts = response.extraOpts;

      const disableMSE = extraOpts?.disableMSE;

      return `
<!-- WB Insert -->
<script>
  const wbinfo = {};
  wbinfo.url = "${url}";
  wbinfo.request_ts = "${requestTS}";
  wbinfo.timestamp = "${timestamp}";
  wbinfo.proxyOrigin = "${request.proxyOrigin || ""}";
  wbinfo.localOrigin = "${request.localOrigin || ""}";
  wbinfo.localTLD = "${request.localTLD || ""}";
  wbinfo.proxyTLD = "${request.proxyTLD || ""}";
  wbinfo.prefix = "${basePrefixTS}";
  wbinfo.presetCookie = ${presetCookieStr};
  wbinfo.seconds = "${seconds}";
  self.__wbinfo = wbinfo;
</script>
<script src="${this.staticPrefix}wombatProxy.js"></script>
${
  this.proxyBannerUrl
    ? `
<script src="${this.proxyPrefix}${this.proxyBannerUrl}"></script>`
    : ``
}
${disableMSE ? DISABLE_MEDIASOURCE_SCRIPT : ""}
<!-- End WB Insert -->
    `;
    };

    const prefix = basePrefixTS + "mp_/";

    const rewriteOpts = {
      baseUrl,
      responseUrl: response.url,
      prefix,
      headInsertFunc,
      workerInsertFunc: null,
      urlRewrite: true,
      contentRewrite: true,
      decode: this.config.decode,
    };

    const rewriter = new ProxyRewriter(rewriteOpts, request);

    response = await rewriter.rewrite(response, request);

    return response;
  }

  getCookiePreset(response: ArchiveResponse, scheme: string) {
    let presetCookie = response.headers.get("x-wabac-preset-cookie") || "";
    const setCookie = response.headers.get("Set-Cookie");
    if (setCookie) {
      presetCookie = parseSetCookie(setCookie, scheme) + ";" + presetCookie;
    }
    return presetCookie ? JSON.stringify(presetCookie) : '""';
  }

  getCanonRedirect(query: ArchiveRequest) {
    // [TODO]
    // eslint-disable-next-line prefer-const
    let { url, timestamp, mod, referrer } = query;
    const schemeRel = url.startsWith("//");

    if (schemeRel) {
      const scheme =
        referrer && referrer.indexOf("/http://") > 0 ? "http:" : "https:";
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
        } else if ((!schemeRel && url.indexOf(":443")) || url.indexOf(":80")) {
          query.url = parsed.href;
        }
      }
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    const headers = new Headers({ "Content-Type": "application/javascript" });
    return new Response(payload, { headers, status, statusText });
  }

  getSrcDocResponse(url: string, base64str?: string) {
    const string = base64str
      ? decodeURIComponent(atob(base64str))
      : "<html><head></head><body></body></html>";
    const payload = new TextEncoder().encode(string);

    const status = 200;
    const statusText = "OK";
    const headers = new Headers({ "Content-Type": "text/html" });
    const date = new Date();
    return new ArchiveResponse({
      payload,
      status,
      statusText,
      headers,
      url,
      date,
    });
  }

  async getBlobResponse(url: string) {
    const resp = await fetch(url);

    const status = resp.status;
    const statusText = resp.statusText;
    const headers = new Headers(resp.headers);
    if (headers.get("content-type") === "application/xhtml+xml") {
      headers.set("content-type", "text/html");
    }
    const date = new Date();
    const payload = new Uint8Array(await resp.arrayBuffer());

    return new ArchiveResponse({
      payload,
      status,
      statusText,
      headers,
      url,
      date,
    });
  }

  async getReplayResponse(
    query: ArchiveRequest,
    event: FetchEvent,
  ): Promise<Response | ArchiveResponse | null> {
    let response: Response | ArchiveResponse | null =
      this.getCanonRedirect(query);

    if (response) {
      return response;
    }

    const opts = { pageId: query.pageId, noRedirect: query.isProxyOrigin };

    response = await this.store.getResource(query, this.prefix, event, opts);

    return response;
  }

  async makeTopFrame(url: string, requestTS: string) {
    let baseUrl = "";

    if (this.baseFrameUrl && !this.baseFramePrefix) {
      baseUrl = this.baseFrameUrl;
    } else if (!this.isRoot && this.config.sourceUrl) {
      baseUrl = this.baseFramePrefix || "./";
      baseUrl += `?source=${this.config.sourceUrl}`;
    }

    if (baseUrl) {
      if (this.baseFrameAppendReplay) {
        baseUrl += `${requestTS}/${url}`;
      } else if (this.baseFrameHashReplay) {
        baseUrl += `#${requestTS}/${url}`;
      } else {
        const locParams = new URLSearchParams({
          url,
          ts: requestTS,
          view: "replay",
        });
        baseUrl += "#" + locParams.toString();
      }

      return Response.redirect(baseUrl);
    }

    let content = "";

    if (this.config.topTemplateUrl) {
      const resp = await fetch(this.config.topTemplateUrl);
      const topTemplate = await resp.text();
      content = topTemplate
        .replace("$URL", url)
        .replace("$TS", requestTS)
        .replace("$PREFIX", this.prefix);
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

    const responseData = {
      status: 200,
      statusText: "OK",
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": this.csp,
      },
    };

    return new Response(content, responseData);
  }

  makeHeadInsert(
    url: string,
    requestTS: string,
    topUrl: string,
    prefix: string,
    response: ArchiveResponse,
    referrer: string,
  ) {
    const coll = this.name;

    const date = response.date;
    const isLive = response.isLive;
    const extraOpts = response.extraOpts;

    const seconds = getSecondsStr(date);

    const timestamp = getTS(date.toISOString());

    const urlParsed = new URL(url);

    let scheme;

    // protocol scheme (for relative urls): if not http/https, try to get actual protocol from referrer
    if (urlParsed.protocol !== "https:" && urlParsed.protocol !== "http:") {
      scheme = referrer && referrer.indexOf("/http://") > 0 ? "http" : "https";
    } else {
      scheme = urlParsed.protocol.slice(0, -1);
    }

    const presetCookieStr = this.getCookiePreset(response, scheme);

    const pixelRatio =
      extraOpts && Number(extraOpts.pixelRatio) ? extraOpts.pixelRatio : 2;

    const storage = extraOpts?.storage
      ? JSON.stringify(extraOpts.storage)
      : '""';

    const disableMSE = extraOpts?.disableMSE;

    return `
<!-- WB Insert -->
${
  this.adblockUrl
    ? `
<link rel='stylesheet' href="${prefix}mp_/adblock:${urlParsed.hostname}"/>
<link rel='stylesheet' href="${prefix}mp_/adblock:"/>
`
    : ""
}
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
  wbinfo.storage = ${storage};
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

  ${
    this.noRewritePrefixes
      ? `
  wbinfo.wombat_opts = {"no_rewrite_prefixes": ${JSON.stringify(this.noRewritePrefixes)}}`
      : `
  wbinfo.wombat_opts = {}
  `
  }

  if (window && window._WBWombatInit) {
    window._WBWombatInit(wbinfo);
  }
    ${disableMSE ? DISABLE_MEDIASOURCE_SCRIPT : ""}
</script>
${this.injectScripts.map((script) => `<script src='${this.proxyPrefix}${script}'> </script>`).join("")}
<!-- End WB Insert -->
`;
  }
}
