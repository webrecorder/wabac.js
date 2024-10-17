import { Collection, type Prefixes } from "./collection";
import { WorkerLoader } from "./loaders";

import { notFound, isAjaxRequest } from "./utils";
import { StatsTracker } from "./statstracker";

import { API } from "./api";

import WOMBAT from "../dist-wombat/wombat.txt";
import WOMBAT_WORKERS from "../dist-wombat/wombatWorkers.txt";

import { ArchiveRequest } from "./request";
import { type CollMetadata } from "./types";

const CACHE_PREFIX = "wabac-";
const IS_AJAX_HEADER = "x-wabac-is-ajax-req";

declare let self: ServiceWorkerGlobalScope;

// ===========================================================================
export class SWCollections extends WorkerLoader {
  prefixes: Prefixes;
  colls: Record<string, Collection>;
  inited: Promise<boolean> | null;

  override root: string | null;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultConfig: Record<string, any>;

  constructor(
    prefixes: Prefixes,
    root: string | null = null,
    defaultConfig = {},
  ) {
    super(self);
    this.prefixes = prefixes;
    this.colls = {};
    this.inited = null;
    this.root = root;
    this.defaultConfig = defaultConfig;

    this._fileHandles = {};
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WorkerLoader'.
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _createCollection(opts: Record<string, any>): Collection {
    return new Collection(opts, this.prefixes, this.defaultConfig);
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WorkerLoader'.
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadAll(dbColl?: any): Promise<boolean> {
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

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WorkerLoader'.
  async reload(name: string) {
    delete this.colls[name];

    await this.getColl(name);
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WorkerLoader'.
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async addCollection(data: any, progressUpdate: any) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const opts = await super.addCollection(data, progressUpdate);

    if (opts && opts.name) {
      this.colls[opts.name] = this._createCollection(opts);
    }

    return opts;
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WorkerLoader'.
  async deleteColl(name: string, keepFileHandle = false) {
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

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WorkerLoader'.
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async initNewColl(metadata: any, extraConfig = {}, type = "archive") {
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

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WorkerLoader'.
  async updateAuth(name: string, headers: Record<string, string>) {
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
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultConfig?: Record<string, any>;
  CollectionsClass?: typeof SWCollections;
};

// ===========================================================================
export class SWReplay {
  prefix: string;
  replayPrefix: string;
  staticPrefix: string;
  distPrefix: string;

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  staticData: Map<string, any>;

  collections: SWCollections;

  proxyOriginMode: boolean;

  api: API;
  apiPrefix: string;

  allowRewrittenCache: boolean;

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

    this.replayPrefix = this.prefix;

    const sp = new URLSearchParams(self.location.search);

    let replayPrefixPath = "w";

    if (sp.has("replayPrefix")) {
      replayPrefixPath = sp.get("replayPrefix")!;
    }

    if (replayPrefixPath) {
      this.replayPrefix += replayPrefixPath + "/";
    }

    this.staticPrefix = this.prefix + "static/";
    this.distPrefix = this.prefix + "dist/";

    const prefixes: Prefixes = {
      static: this.staticPrefix,
      root: this.prefix,
      main: this.replayPrefix,
    };

    this.staticData = staticData || new Map();
    this.staticData.set(this.staticPrefix + "wombat.js", {
      type: "application/javascript",
      content: WOMBAT,
    });
    this.staticData.set(this.staticPrefix + "wombatWorkers.js", {
      type: "application/javascript",
      content: WOMBAT_WORKERS,
    });

    if (sp.has("serveIndex")) {
      const indexData = { type: "text/html", content: this.getIndexHtml(sp) };
      this.staticData.set(this.prefix, indexData);
      this.staticData.set(this.prefix + "index.html", indexData);
    }

    if (sp.has("injectScripts")) {
      const injectScripts = sp.get("injectScripts")!.split(",");
      // @ts-expect-error [TODO] - TS4111 - Property 'injectScripts' comes from an index signature, so it must be accessed with ['injectScripts']. | TS4111 - Property 'injectScripts' comes from an index signature, so it must be accessed with ['injectScripts'].
      defaultConfig.injectScripts = defaultConfig.injectScripts
        ? // @ts-expect-error [TODO] - TS4111 - Property 'injectScripts' comes from an index signature, so it must be accessed with ['injectScripts'].
          [...injectScripts, ...defaultConfig.injectScripts]
        : injectScripts;
    }

    // @ts-expect-error [TODO] - TS4111 - Property 'injectScripts' comes from an index signature, so it must be accessed with ['injectScripts'].
    if (defaultConfig.injectScripts) {
      // @ts-expect-error [TODO] - TS4111 - Property 'injectScripts' comes from an index signature, so it must be accessed with ['injectScripts']. | TS4111 - Property 'injectScripts' comes from an index signature, so it must be accessed with ['injectScripts'].
      defaultConfig.injectScripts = defaultConfig.injectScripts.map(
        (url: string) => this.staticPrefix + "proxy/" + url,
      );
    }

    if (sp.has("adblockUrl")) {
      // @ts-expect-error [TODO] - TS4111 - Property 'adblockUrl' comes from an index signature, so it must be accessed with ['adblockUrl'].
      defaultConfig.adblockUrl = sp.get("adblockUrl");
    }

    this.collections = new CollectionsClass(
      prefixes,
      sp.get("root"),
      defaultConfig,
    );
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.collections.loadAll(sp.get("dbColl"));

    this.proxyOriginMode = !!sp.get("proxyOriginMode");

    this.api = new ApiClass(this.collections);
    this.apiPrefix = this.replayPrefix + "api/";

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

  handleFetch(event: FetchEvent): Promise<Response> | Response {
    const url = event.request.url;

    if (this.proxyOriginMode) {
      return this.getResponseFor(event.request, event);
    }

    // if not on our domain, just pass through (loading handled in local worker)
    if (!url.startsWith(this.prefix)) {
      if (url === "chrome-extension://invalid/") {
        return notFound(event.request, "Invalid URL");
      }
      return this.defaultFetch(event.request);
    }

    // special handling when root collection set: pass through any root files, eg. /index.html
    if (
      this.collections.root &&
      url.slice(this.prefix.length).indexOf("/") < 0
    ) {
      return this.defaultFetch(event.request);
    }

    // JS rewrite on static/external files not from archive
    if (url.startsWith(this.staticPrefix + "proxy/")) {
      return this.staticPathProxy(url, event.request);
    }

    // handle replay / api
    if (
      url.startsWith(this.replayPrefix) &&
      !url.startsWith(this.staticPrefix)
    ) {
      return this.getResponseFor(event.request, event);
    }

    // current domain, but not replay, check if should cache ourselves or serve static data
    const parsedUrl = new URL(url);
    parsedUrl.search = "";
    parsedUrl.hash = "";
    const urlOnly = parsedUrl.href;

    for (const staticPath of this.staticData.keys()) {
      if (staticPath === urlOnly) {
        const { content, type } = this.staticData.get(staticPath);
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        return new Response(content, { headers: { "Content-Type": type } });
      }
    }

    // only cache: urls in the root directory (no more slashes)
    if (
      (parsedUrl.protocol == "http:" || parsedUrl.protocol == "https:") &&
      parsedUrl.pathname.indexOf("/", 1) < 0
    ) {
      return this.handleOffline(event.request);
    } else {
      return this.defaultFetch(event.request);
    }
  }

  async staticPathProxy(url: string, request: Request) {
    url = url.slice((this.staticPrefix + "proxy/").length);
    url = new URL(url, self.location.href).href;
    request = new Request(url);
    return this.defaultFetch(request);
  }

  async defaultFetch(request: Request) {
    const opts: RequestInit = {};
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
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

      //console.log(`Auto Cacheing: ${url}`);
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
    if (!this.proxyOriginMode && request.url.startsWith(this.apiPrefix)) {
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
      // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string | null'.
      collId = request.url.slice(this.replayPrefix.length).split("/", 1)[0];
    }

    // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | null' is not assignable to parameter of type 'string'.
    const coll = await this.collections.getColl(collId);

    if (
      !coll ||
      (!this.proxyOriginMode && !request.url.startsWith(coll.prefix))
    ) {
      return notFound(request);
    }

    const wbUrlStr = this.proxyOriginMode
      ? request.url
      : request.url.substring(coll.prefix.length);

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: Record<string, any> = {
      isRoot: !!this.collections.root,
    };

    if (this.proxyOriginMode) {
      // @ts-expect-error [TODO] - TS4111 - Property 'mod' comes from an index signature, so it must be accessed with ['mod'].
      opts.mod = "id_";
      // @ts-expect-error [TODO] - TS4111 - Property 'proxyOrigin' comes from an index signature, so it must be accessed with ['proxyOrigin']. | TS4111 - Property 'extraConfig' comes from an index signature, so it must be accessed with ['extraConfig'].
      opts.proxyOrigin = coll.config.extraConfig.proxyOrigin;
      // @ts-expect-error [TODO] - TS4111 - Property 'localOrigin' comes from an index signature, so it must be accessed with ['localOrigin'].
      opts.localOrigin = self.location.origin;
    }

    const archiveRequest = new ArchiveRequest(wbUrlStr, request, opts);

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
