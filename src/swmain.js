"use strict";

import { Collection } from "./collection";
import { WorkerLoader } from "./loaders";

import { notFound, isAjaxRequest } from "./utils.js";
import { StatsTracker } from "./statstracker.js";

import { API } from "./api.js";

import WOMBAT from "../dist/wombat.js";
import WOMBAT_WORKERS from "@webrecorder/wombat/src/wombatWorkers.js";
import { ArchiveRequest } from "./request";

const CACHE_PREFIX = "wabac-";
const IS_AJAX_HEADER = "x-wabac-is-ajax-req";


// ===========================================================================
class SWCollections extends WorkerLoader
{
  constructor(prefixes, root = null, checkIpfs = false, defaultConfig = {}) {
    super(self);
    this.prefixes = prefixes;
    this.colls = null;
    this.inited = null;
    this.root = root;
    this.checkIpfs = checkIpfs;
    this.defaultConfig = defaultConfig;

    this._fileHandles = {};
  }

  _createCollection(opts) {
    return new Collection(opts, this.prefixes, this.defaultConfig);
  }

  loadAll(dbColl) {
    this.colls = {};
    this.inited = super.loadAll(dbColl);
    return this.inited;
  }

  async getColl(name) {
    if (!this.colls[name]) {
      this.colls[name] = await this.loadColl(name);
    }
    return this.colls[name];
  }

  async reload(name) {
    delete this.colls[name];

    await this.getColl(name);
  }

  async addCollection(data, progressUpdate) {
    const opts = await super.addCollection(data, progressUpdate);

    if (opts && opts.name) {
      this.colls[opts.name] = this._createCollection(opts);
    }

    return opts;
  }

  async deleteColl(name, keepFileHandle = false) {
    if (this.colls[name]) {
      if (this.colls[name].store && this.colls[name].store.delete) {
        await this.colls[name].store.delete();
      }

      if (keepFileHandle && this.colls[name].config && this.colls[name].config.extra &&
        this.colls[name].config.extra.fileHandle) {
        this._fileHandles[this.colls[name].config.sourceUrl] = this.colls[name].config.extra.fileHandle;
      }
    }

    if (!await super.deleteColl(name)) {
      return false;
    }
    delete this.colls[name];
    return true;
  }

  async initNewColl(metadata, extraConfig = {}, type = "archive") {
    const coll = await super.initNewColl(metadata, extraConfig, type);
    if (coll) {
      this.colls[coll.name] = coll;
    }
    return coll;
  }

  async updateAuth(name, headers) {
    if (this.colls[name] && this.colls[name].store.updateHeaders) {
      this.colls[name].store.updateHeaders(headers);
    }

    await super.updateAuth(name, headers);
  }

  async updateMetadata(name, newMetadata) {
    const metadata = await super.updateMetadata(name, newMetadata);
    if (this.colls[name] && metadata) {
      this.colls[name].config.metadata = metadata;
      this.colls[name].metadata = metadata;
    }
    return metadata;
  }

  async updateSize(name, fullSize, dedupSize, updateDecode) {
    const metadata = await super.updateSize(name, fullSize, dedupSize, updateDecode);
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


// ===========================================================================
class SWReplay {
  constructor({staticData = null, ApiClass = API, useIPFS = true, defaultConfig = {}, CollectionsClass = SWCollections} = {}) {
    this.prefix = self.registration ? self.registration.scope : "";

    this.replayPrefix = this.prefix;

    const sp = new URLSearchParams(self.location.search);

    let replayPrefixPath = "w";

    if (sp.has("replayPrefix")) {
      replayPrefixPath = sp.get("replayPrefix");
    }

    if (replayPrefixPath) {
      this.replayPrefix += replayPrefixPath + "/";
    }

    this.staticPrefix = this.prefix + "static/";
    this.distPrefix = this.prefix + "dist/";

    const prefixes = {
      static: this.staticPrefix,
      root: this.prefix,
      main: this.replayPrefix
    };

    this.staticData = staticData || new Map();
    this.staticData.set(this.staticPrefix + "wombat.js", {type: "application/javascript", content: WOMBAT});
    this.staticData.set(this.staticPrefix + "wombatWorkers.js", {type: "application/javascript", content: WOMBAT_WORKERS});

    if (defaultConfig.injectScripts) {
      defaultConfig.injectScripts = defaultConfig.injectScripts.map(url => this.staticPrefix + "proxy/" + url);
    }

    this.collections = new CollectionsClass(prefixes, sp.get("root"), useIPFS, defaultConfig);
    this.collections.loadAll(sp.get("dbColl"));

    this.proxyOriginMode = !!sp.get("proxyOriginMode");

    this.api = new ApiClass(this.collections);
    this.apiPrefix = this.replayPrefix + "api/";

    this.allowRewrittenCache = sp.get("allowCache") ? true : false;

    this.stats = sp.get("stats") ? new StatsTracker() : null;

    self.addEventListener("install", () => {
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

  handleFetch(event) {
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
    if (this.collections.root && url.slice(this.prefix.length).indexOf("/") < 0) {
      return this.defaultFetch(event.request);
    }

    // JS rewrite on static/external files not from archive
    if (url.startsWith(this.staticPrefix + "proxy/")) {
      return this.staticPathProxy(url, event.request);
    }

    // handle replay / api
    if (url.startsWith(this.replayPrefix) && !url.startsWith(this.staticPrefix)) {
      return this.getResponseFor(event.request, event);
    }

    // current domain, but not replay, check if should cache ourselves or serve static data
    const parsedUrl = new URL(url);
    parsedUrl.search = "";
    parsedUrl.hash = "";
    const urlOnly = parsedUrl.href;

    for (const staticPath of this.staticData.keys()) {
      if (staticPath === urlOnly) {
        const { content, type} = this.staticData.get(staticPath);
        return new Response(content, {headers: {"Content-Type": type}});
      }
    }

    // only cache: urls in the root directory (no more slashes)
    if ((parsedUrl.protocol == "http:" || parsedUrl.protocol == "https:") && (parsedUrl.pathname.indexOf("/", 1) < 0)) {
      return this.handleOffline(event.request);
    } else {
      return this.defaultFetch(event.request);
    }
  }

  staticPathProxy(url, request) {
    url = url.slice((this.staticPrefix + "proxy/").length);
    url = new URL(url, self.location.href).href;
    request = new Request(url);
    return this.defaultFetch(request);
  }

  defaultFetch(request) {
    const opts = {};
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
      opts.cache = "default";
    }
    return self.fetch(request, opts);
  }

  async ensureCached(urls) {
    const cache = await caches.open("wabac-offline");

    for (let url of urls) {
      url = new URL(url, self.location.href).href;
      let response = await cache.match(url, {ignoreSearch: true});
      if (response) {
        continue;
      }

      //console.log(`Auto Cacheing: ${url}`);
      try {
        response = await this.defaultFetch(url);
        await cache.put(url, response);
      } catch(e) {
        console.warn(`Failed to Auto Cache: ${url}`, e);
      }
    }
  }

  async handleOffline(request) {
    let response = null;
    
    const cache = await caches.open("wabac-offline");

    try {
      response = await this.defaultFetch(request);

    } catch(e) {
      response = await cache.match(request, {ignoreSearch: true});
      if (!response) {
        response = notFound(request, "Sorry, this url was not cached for offline use");
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

  async getResponseFor(request, event) {
    // API
    if (!this.proxyOriginMode && request.url.startsWith(this.apiPrefix)) {
      if (this.stats && request.url.startsWith(this.apiPrefix + "stats.json")) {
        return await this.stats.getStats(event);
      }
      return await this.api.apiResponse(request.url.slice(this.apiPrefix.length), request, event);
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
    } catch (e) {
      // ignore, not cached
    }

    let collId = this.collections.root;

    if (!collId) {
      collId = request.url.slice(this.replayPrefix.length).split("/", 1)[0];
    }

    const coll = await this.collections.getColl(collId);

    if (!coll || (!this.proxyOriginMode && !request.url.startsWith(coll.prefix))) {
      return notFound(request);
    }

    const wbUrlStr = this.proxyOriginMode ? request.url : request.url.substring(coll.prefix.length);

    const opts = {
      isRoot: !!this.collections.root
    };

    if (this.proxyOriginMode) {
      opts.mod = "id_";
      opts.proxyOrigin = coll.config.extraConfig.proxyOrigin;
      opts.localOrigin = self.location.origin;
    }

    const archiveRequest = new ArchiveRequest(wbUrlStr, request, opts);

    if (!archiveRequest.url) {
      return notFound(request, `Replay URL ${wbUrlStr} not found`);
    }

    const response = await coll.handleRequest(archiveRequest, event);

    if (response) {
      if (this.stats) {
        this.stats.updateStats(response.date, response.status, request, event);
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

export { SWReplay, SWCollections };

