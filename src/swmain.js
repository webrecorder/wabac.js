"use strict";

import { Collection } from './collection';
import { CollectionLoader } from './loaders';

import { notFound, isAjaxRequest } from './utils.js';
import { StatsTracker } from './statstracker.js';

import { API } from './api.js';

import WOMBAT from '../dist/wombat.js';
import WOMBAT_WORKERS from 'wombat/src/wombatWorkers.js';

const CACHE_PREFIX = "wabac-";
const IS_AJAX_HEADER = "x-wabac-is-ajax-req";


// ===========================================================================
class SWCollections extends CollectionLoader
{
  constructor(prefixes, root = null) {
    super();
    this.prefixes = prefixes;
    this.colls = null;
    this.inited = null;
    this.root = root;
  }

  _createCollection(opts) {
    return new Collection(opts, this.prefixes);
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

  async deleteColl(name) {
    if (this.colls[name]) {
      await this.colls[name].store.delete();
    }

    await super.deleteColl(name);
    delete this.colls[name];
    return true;
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
}


// ===========================================================================
class SWReplay {
  constructor(staticData = null) {
    this.prefix = self.registration ? self.registration.scope : '';

    this.replayPrefix = this.prefix;

    const sp = new URLSearchParams(self.location.search);

    let replayPrefixPath = "wabac";

    if (sp.has("replayPrefix")) {
      replayPrefixPath = sp.get("replayPrefix");
    }

    if (replayPrefixPath) {
      this.replayPrefix += replayPrefixPath + "/";
    }

    this.staticPrefix = this.prefix + "static/";
    this.distPrefix = this.prefix + "dist/";

    const prefixes = {static: this.staticPrefix,
                      root: this.prefix,
                      main: this.replayPrefix
                     };

    this.staticData = staticData || new Map();
    this.staticData.set(this.staticPrefix + "wombat.js", {type: "application/javascript", content: WOMBAT});
    this.staticData.set(this.staticPrefix + "wombatWorkers.js", {type: "application/javascript", content: WOMBAT_WORKERS});

    this.collections = new SWCollections(prefixes, sp.get("root"));
    this.collections.loadAll(sp.get("dbColl"));

    this.api = new API(this.collections);
    this.apiPrefix = this.replayPrefix + "api/";

    this.allowRewrittenCache = sp.get("allowCache") ? true : false;

    this.stats = sp.get("stats") ? new StatsTracker() : null;

    self.addEventListener('install', (event) => {
      self.skipWaiting();
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(self.clients.claim());
      console.log("Activate!");
    });

    self.addEventListener('fetch', (event) => {
      event.respondWith(this.handleFetch(event));
    });

    self.addEventListener("message", (event) => {
      if (event.data.msg_type === "reload_all") {
        this.collections.loadAll();
      }
    });
  }

  handleFetch(event) {
    const url = event.request.url;

    // if not on our domain, just pass through (loading handled in local worker)
    if (!url.startsWith(this.prefix)) {
      return this.defaultFetch(event.request);
    }

    // special handling when root collection set: pass through any root files, eg. /index.html
    if (this.collections.root && url.slice(this.prefix.length).indexOf("/") < 0) {
      return this.defaultFetch(event.request);
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

  defaultFetch(request) {
    const opts = {};
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      opts.cache = 'default';
    }
    return self.fetch(request, opts);
  }

  async ensureCached(urls) {
    const cache = await caches.open('wabac-offline');

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
    
    const cache = await caches.open('wabac-offline');

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
    if (request.url.startsWith(this.apiPrefix)) {
      if (this.stats && request.url.startsWith(this.apiPrefix + "stats.json")) {
        return await this.stats.getStats(event);
      }
      return await this.api.apiResponse(request.url.slice(this.apiPrefix.length), request.method, request);
    }

    if (request.method === "POST") {
      request = await this.toGetRequest(request);
    }

    await this.collections.inited;

    let response = null;

    const isAjax = isAjaxRequest(request);
    const range = request.headers.get('range');

    try {
      if (this.allowRewrittenCache && !range) {
        response = await self.caches.match(request);
        if (response && !!response.headers.get(IS_AJAX_HEADER) === isAjax) {
          return response;
        }
      }
    } catch (e) {
      response = null;
    }

    let collId = this.collections.root;

    if (!collId) {
      collId = request.url.slice(this.replayPrefix.length).split("/", 1)[0];
    }

    const coll = await this.collections.getColl(collId);

    if (coll && (response = await coll.handleRequest(request, event))) {
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
          await cache.put(getRequest, cacheResp);
        } catch (e) {
          console.warn(e);
        }
      }

      return response;
    }

    if (range) {
      console.log('Not Found Range!: ' + range);
    }

    return notFound(request);
  }

  async toGetRequest(request) {
    let query = null;

    const contentType = request.headers.get("Content-Type");

    if (request.method === "POST" || request.method === "PUT") {
      switch (contentType) {
        case "application/x-www-form-urlencoded":
          query = await request.text();
          break;

        // default:
        //   query = "____wabac_method=" + request.method.toLowerCase();
        //   const buff = await request.arrayBuffer();
        //   if (buff.byteLength > 0) {
        //     const text = new TextDecoder().decode(buff);
        //     query += "&" + text;//btoa(text);
        //   }
      }
    }

    const newUrl = request.url + (request.url.indexOf("?") >= 0 ? "&" : "?") + query;

    //console.log(`${request.method} ${request.url} ->  ${newUrl}`);

    const options = {
      method: "GET",
      headers: request.headers,
      mode: (request.mode === 'navigate' ? 'same-origin' : request.mode),
      credentials: request.credentials,
      cache: request.cache,
      redirect: request.redirect,
      referrer: request.referrer,
      integrity: request.integrity,
    }

    return new Request(newUrl, options);
  }
}

export { SWReplay };

