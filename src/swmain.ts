import { Collection, type Prefixes } from "./collection";
import { WorkerLoader } from "./loaders";

import {
  addProxyAllowPaths,
  getCSP,
  isAjaxRequest,
  proxyAllowPaths,
  updateCSP,
} from "./utils";
import { StatsTracker } from "./statstracker";

import { API } from "./api";

import WOMBAT from "../dist-wombat/wombat.txt";
import WOMBAT_WORKERS from "../dist-wombat/wombatWorkers.txt";
import WOMBAT_PROXY from "../dist-wombat/wombatProxy.txt";

import {
  ArchiveRequest,
  resolveFullUrlFromReferrer,
  type ArchiveRequestInitOpts,
} from "./request";
import { type ExtraConfig, type CollMetadata } from "./types";
import { notFound } from "./notfound";
import { setUseHashCHeck } from "./wacz/ziprangereader";

const CACHE_PREFIX = "wabac-";
const IS_AJAX_HEADER = "x-wabac-is-ajax-req";

declare let self: ServiceWorkerGlobalScope;

// ===========================================================================
export class SWCollections extends WorkerLoader {
  prefixes: Prefixes;
  colls: Record<string, Collection>;
  inited: Promise<boolean> | null;

  override root: string | null;

  defaultConfig: ExtraConfig;

  constructor(
    prefixes: Prefixes,
    root: string | null = null,
    defaultConfig: ExtraConfig = {},
  ) {
    super(self);
    this.prefixes = prefixes;
    this.colls = {};
    this.inited = null;
    this.root = root;
    this.defaultConfig = defaultConfig;

    this._fileHandles = {};
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override _createCollection(opts: Record<string, any>): Collection {
    return new Collection(opts, this.prefixes, this.defaultConfig);
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async loadAll(dbColl?: any): Promise<boolean> {
    this.colls = {};
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.inited = super.loadAll(dbColl);
    return this.inited;
  }

  async getColl(name: string) {
    if (!this.colls[name]) {
      this.colls[name] = await this.loadColl(name);
    }
    return this.colls[name];
  }

  override async reload(name: string) {
    delete this.colls[name];

    await this.getColl(name);
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async addCollection(data: any, progressUpdate: any) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const opts = await super.addCollection(data, progressUpdate);

    if (opts && opts.name) {
      // if name matches root collection, mark as root
      if (this.root === opts.name) {
        opts.config.root = true;
      }
      this.colls[opts.name] = this._createCollection(opts);
    }

    return opts;
  }

  override async deleteColl(name: string, keepFileHandle = false) {
    if (this.colls[name]) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.colls[name].store) {
        await this.colls[name].store.delete();
      }

      if (
        this._fileHandles &&
        keepFileHandle &&
        this.colls[name].config.extra?.fileHandle
      ) {
        this._fileHandles[this.colls[name].config.sourceUrl] =
          this.colls[name].config.extra.fileHandle;
      }
    }

    if (!(await super.deleteColl(name))) {
      return false;
    }
    delete this.colls[name];
    return true;
  }

  override async initNewColl(
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: any,
    extraConfig = {},
    type = "archive",
  ) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const coll = await super.initNewColl(metadata, extraConfig, type);
    if (coll) {
      this.colls[coll.name] = coll;
    }
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return coll;
  }

  override async updateAuth(name: string, headers: Record<string, string>) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (this.colls[name] && (this.colls[name].store as any).updateHeaders) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.colls[name].store as any).updateHeaders(headers);
    }

    return await super.updateAuth(name, headers);
  }

  override async updateMetadata(name: string, newMetadata: CollMetadata) {
    const metadata = await super.updateMetadata(name, newMetadata);
    if (this.colls[name] && metadata) {
      this.colls[name].config.metadata = metadata;
      this.colls[name].metadata = metadata;
    }
    return metadata;
  }

  override async updateSize(
    name: string,
    fullSize: number,
    dedupSize: number,
    updateDecode?: boolean,
  ) {
    const metadata = await super.updateSize(
      name,
      fullSize,
      dedupSize,
      updateDecode,
    );
    if (this.colls[name] && metadata) {
      this.colls[name].config.metadata = metadata;
      this.colls[name].metadata = metadata;
    }
    if (updateDecode !== undefined && this.colls[name]) {
      this.colls[name].config.decode = updateDecode;
    }
    return metadata;
  }
}

type SWReplayInitOpts = {
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  staticData?: Map<string, any> | null;
  ApiClass?: typeof API;
  defaultConfig?: ExtraConfig;
  CollectionsClass?: typeof SWCollections;
};

// ===========================================================================
export class SWReplay {
  prefix: string;
  replayPrefix: string;
  staticPrefix: string;
  distPrefix: string;
  proxyPrefix: string;

  staticData: Map<string, { type: string; content: string }>;

  collections: SWCollections;

  proxyOriginMode: boolean;

  api: API;
  apiPrefix: string;

  allowRewrittenCache: boolean;
  topFramePassthrough = false;

  stats: StatsTracker | null;

  constructor({
    staticData = null,
    ApiClass = API,
    defaultConfig = {},
    CollectionsClass = SWCollections,
  }: SWReplayInitOpts = {}) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    this.prefix = self.registration ? self.registration.scope : "";

    const sp = new URLSearchParams(self.location.search);

    this.proxyOriginMode = !!sp.get("proxyOriginMode");

    if (this.proxyOriginMode) {
      this.replayPrefix = this.prefix + "__wb_proxy/";
      this.staticPrefix = this.replayPrefix + "static/";
      this.proxyPrefix = "https://wab.ac/proxy/";
      this.apiPrefix = "https://wab.ac/api/";
    } else {
      const suffix = sp.get("replayPrefix") ?? "w";
      this.topFramePassthrough = !suffix;
      this.replayPrefix = this.prefix + suffix + (suffix ? "/" : "");
      this.staticPrefix = this.prefix + "static/";
      this.proxyPrefix = this.staticPrefix + "proxy/";
      this.apiPrefix = this.replayPrefix + "api/";
    }

    updateCSP(this.replayPrefix);

    this.distPrefix = this.prefix + "dist/";

    this.staticData = staticData || new Map();
    this.staticData.set(this.staticPrefix + "wombat.js", {
      type: "application/javascript",
      content: WOMBAT,
    });
    this.staticData.set(this.staticPrefix + "wombatWorkers.js", {
      type: "application/javascript",
      content: WOMBAT_WORKERS,
    });
    this.staticData.set(this.staticPrefix + "wombatProxy.js", {
      type: "application/javascript",
      content: WOMBAT_PROXY,
    });

    if (sp.has("serveIndex")) {
      const indexData = { type: "text/html", content: this.getIndexHtml(sp) };
      this.staticData.set(this.prefix, indexData);
      this.staticData.set(this.prefix + "index.html", indexData);
    }

    if (sp.has("injectScripts")) {
      const injectScripts = sp.get("injectScripts")!.split(",");
      defaultConfig.injectScripts = defaultConfig.injectScripts
        ? [...injectScripts, ...defaultConfig.injectScripts]
        : injectScripts;
    }

    if (defaultConfig.injectScripts) {
      addProxyAllowPaths(defaultConfig.injectScripts);
    }

    if (sp.has("allowProxyPaths")) {
      addProxyAllowPaths(sp.get("allowProxyPaths")!.split(","));
    }

    if (sp.has("adblockUrl")) {
      defaultConfig.adblockUrl = sp.get("adblockUrl") || "";
    }

    if (sp.get("useHashCheck") === "1") {
      setUseHashCHeck(true);
    }

    const prefixes: Prefixes = {
      static: this.staticPrefix,
      root: this.prefix,
      main: this.replayPrefix,
      proxy: this.proxyPrefix,
      api: this.apiPrefix,
    };

    this.collections = new CollectionsClass(
      prefixes,
      sp.get("root"),
      defaultConfig,
    );
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.collections.loadAll(sp.get("dbColl"));

    this.api = new ApiClass(this.collections);

    this.allowRewrittenCache = sp.get("allowCache") ? true : false;

    this.stats = sp.get("stats") ? new StatsTracker() : null;

    self.addEventListener("install", () => {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      self.skipWaiting();
    });

    self.addEventListener("activate", (event) => {
      event.waitUntil(self.clients.claim());
      console.log("Activate!");
    });

    self.addEventListener("fetch", (event) => {
      event.respondWith(this.handleFetch(event));
    });

    self.addEventListener("message", (event) => {
      if (event.data.msg_type === "reload_all") {
        event.waitUntil(this.collections.loadAll());
      }
    });
  }

  getIndexHtml(sp: URLSearchParams) {
    const uiScript = sp.get("indexScript") || "./ui.js";
    const appTag = sp.get("indexAppTag") || "replay-app-main";
    return `
    <!doctype html>
    <html>
    <head><script src="${uiScript}"></script></head>
    <body>
    <${appTag}></${appTag}>
    </body></html>`;
  }

  isFromReplay(request: Request) {
    return (
      request.url.startsWith(this.replayPrefix) ||
      request.referrer.startsWith(this.replayPrefix)
    );
  }

  async handleFetch(event: FetchEvent): Promise<Response> {
    const request = event.request;
    const url = request.url;

    if (this.proxyOriginMode) {
      if (url.startsWith(this.proxyPrefix)) {
        return this.staticPathProxy(url, request);
      }
      if (!url.startsWith(this.staticPrefix)) {
        return this.getResponseFor(request, event);
      }
    } else {
      // if not on our domain, return not found
      if (!url.startsWith(this.prefix)) {
        if (url === "chrome-extension://invalid/") {
          return notFound(request, "Invalid URL");
        }

        // don't allow passing through for better security
        if (this.isFromReplay(request)) {
          return notFound(request);
        }
        return this.defaultFetch(request);
      }

      // special handling when root collection set: pass through any root files, eg. /index.html
      if (
        this.collections.root &&
        url.slice(this.prefix.length).indexOf("/") < 0
      ) {
        return this.defaultFetch(request);
      }

      // JS rewrite on static/external files not from archive
      if (url.startsWith(this.proxyPrefix)) {
        return this.staticPathProxy(url, request);
      }

      // handle replay / api
      if (
        url.startsWith(this.replayPrefix) &&
        !url.startsWith(this.staticPrefix)
      ) {
        return this.getResponseFor(request, event);
      }
    }

    // current domain, but not replay, check if should cache ourselves or serve static data
    const parsedUrl = new URL(url);
    parsedUrl.search = "";
    parsedUrl.hash = "";
    const urlOnly = parsedUrl.href;

    for (const staticPath of this.staticData.keys()) {
      if (staticPath === urlOnly) {
        const { content, type } = this.staticData.get(staticPath)!;
        const headers = new Headers({ "Content-Type": type });
        if (this.isFromReplay(request)) {
          headers.set("Content-Security-Policy", getCSP());
        }
        return new Response(content, { headers });
      }
    }

    // if request is to '<origin>/newPath but referrer is from <origin>/collection/<url>/<path>,
    // redirect to <origin>/collection/<url>/newPath
    // correct rewriting should prevent this, but add as secondary fallback
    if (
      !this.topFramePassthrough &&
      !url.startsWith(this.staticPrefix) &&
      request.referrer.startsWith(this.replayPrefix)
    ) {
      const newUrl = resolveFullUrlFromReferrer(url, request.referrer);
      if (!newUrl) {
        return notFound(request);
      }
      return Response.redirect(newUrl);
    }

    // only cache: urls in the root directory (no more slashes)
    if (
      (parsedUrl.protocol == "http:" || parsedUrl.protocol == "https:") &&
      parsedUrl.pathname.indexOf("/", 1) < 0
    ) {
      return this.wrapCSPForFrame(await this.handleOffline(request), request);
    } else {
      return this.wrapCSPForFrame(await this.defaultFetch(request), request);
    }
  }

  async staticPathProxy(url: string, request: Request) {
    url = url.slice(this.proxyPrefix.length);

    const urlObj = new URL(url, self.location.href);
    url = urlObj.href;

    let allowed = false;

    for (const allow of proxyAllowPaths) {
      if (url.startsWith(allow)) {
        allowed = true;
        break;
      }
    }

    if (!allowed) {
      return notFound(request);
    }

    const { method } = request;
    // Because of CORS restrictions, the request cannot be a ReadableStream, so instead we get it as a string.
    // If in the future we need to support streaming, we can revisit this — there may be a way to get it to work.
    const body = method !== "GET" ? await request.arrayBuffer() : null;

    const requestInit: RequestInit = {
      cache: "no-store",
      headers: request.headers,
      method,
      ...(method !== "GET" && { body }),
    };

    const resp = await this.defaultFetch(url, requestInit);

    return this.wrapCSPForFrame(resp, request);
  }

  async wrapCSPForFrame(resp: Response, request: Request) {
    // if target is an iframe, ensure CSP headers are added
    // otherwise, skip as may be loading SW itself
    if (!request.destination.endsWith("frame")) {
      return resp;
    }
    const { status, statusText } = resp;
    const headers = new Headers(resp.headers);
    headers.set("Content-Security-Policy", getCSP());

    return new Response(resp.body, { status, statusText, headers });
  }

  async defaultFetch(request: RequestInfo | URL, opts: RequestInit = {}) {
    if (
      !opts.cache &&
      typeof request !== "string" &&
      !(request instanceof URL) &&
      request.cache === "only-if-cached" &&
      request.mode !== "same-origin"
    ) {
      opts.cache = "default";
    }
    return self.fetch(request, opts);
  }

  async ensureCached(urls: string[]) {
    const cache = await caches.open("wabac-offline");

    for (let url of urls) {
      url = new URL(url, self.location.href).href;
      let response = await cache.match(url, { ignoreSearch: true });
      if (response) {
        continue;
      }

      //console.log(`Auto Caching: ${url}`);
      try {
        response = await this.defaultFetch(new Request(url));
        await cache.put(url, response);
      } catch (e) {
        console.warn(`Failed to Auto Cache: ${url}`, e);
      }
    }
  }

  async handleOffline(request: Request): Promise<Response> {
    let response: Response | null | undefined = null;

    const cache = await caches.open("wabac-offline");

    try {
      response = await this.defaultFetch(request);
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      response = await cache.match(request, { ignoreSearch: true });
      if (!response) {
        response = notFound(
          request,
          "Sorry, this url was not cached for offline use",
        );
      }
      return response;
    }

    if (request.url.startsWith(this.prefix + "?")) {
      return response;
    }

    if (response.status === 200) {
      const cacheResponse = response.clone();
      await cache.put(request, cacheResponse);
      //console.log(`Cached: ${request.method} ${request.url}`);
    } else {
      console.warn(`Not Cacheing ${request.url} - Status ${response.status}`);
    }

    return response;
  }

  async getResponseFor(request: Request, event: FetchEvent) {
    // API
    if (request.url.startsWith(this.apiPrefix)) {
      if (this.stats && request.url.startsWith(this.apiPrefix + "stats.json")) {
        return await this.stats.getStats(event);
      }
      return await this.api.apiResponse(
        request.url.slice(this.apiPrefix.length),
        request,
        event,
      );
    }

    await this.collections.inited;

    const isAjax = isAjaxRequest(request);
    const range = request.headers.get("range");

    try {
      if (this.allowRewrittenCache && !range) {
        const response = await self.caches.match(request);
        if (response && !!response.headers.get(IS_AJAX_HEADER) === isAjax) {
          return response;
        }
      }
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // ignore, not cached
    }

    let collId = this.collections.root;

    if (!collId) {
      collId = request.url.slice(this.replayPrefix.length).split("/", 1)[0]!;
    }

    const coll = await this.collections.getColl(collId);

    // proxy origin, but no collection registered, just pass through to ensure setup is completed
    if (!coll && (this.proxyOriginMode || this.topFramePassthrough)) {
      return this.defaultFetch(request);
    }

    if (!coll) {
      return notFound(request);
    }

    if (
      !this.collections.root &&
      !this.proxyOriginMode &&
      !request.url.startsWith(coll.prefix)
    ) {
      return notFound(request);
    }

    let wbUrlStr;
    let defaultReplayMode = false;

    if (request.url.startsWith(coll.prefix) || !this.proxyOriginMode) {
      wbUrlStr = request.url.substring(coll.prefix.length);
      defaultReplayMode = true;
    } else {
      wbUrlStr = request.url;
    }

    const opts: ArchiveRequestInitOpts = {
      isRoot: !!this.collections.root,
      defaultReplayMode,
    };

    if (this.proxyOriginMode && !defaultReplayMode) {
      opts.mod = "id_";
      opts.proxyOrigin = coll.config.extraConfig?.proxyOrigin;
      opts.proxyTLD = coll.config.extraConfig?.proxyTLD;
      opts.localTLD = coll.config.extraConfig?.localTLD;
      opts.ts = coll.config.extraConfig?.proxyTs || "";
      opts.localOrigin = self.location.origin;
    }

    const archiveRequest = new ArchiveRequest(wbUrlStr, request, opts);

    if (this.topFramePassthrough) {
      if (!archiveRequest.url || !archiveRequest.mod) {
        return this.defaultFetch(request);
      }
    }

    if (!archiveRequest.url) {
      return notFound(request, `Replay URL ${wbUrlStr} not found`);
    }

    const response = await coll.handleRequest(archiveRequest, event);

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (response) {
      if (this.stats) {
        this.stats.updateStats(
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
          response as any,
          response.status,
          request,
          event,
        );
      }

      if (this.allowRewrittenCache && response.status === 200) {
        try {
          const cache = await self.caches.open(CACHE_PREFIX + coll.name);
          if (isAjax) {
            response.headers.set(IS_AJAX_HEADER, "true");
          }
          const cacheResp = response.clone();
          await cache.put(request, cacheResp);
        } catch (e) {
          console.warn(e);
        }
      }

      return response;
    }

    if (range) {
      console.log("Not Found Range!: " + range);
    }

    return notFound(request);
  }
}
