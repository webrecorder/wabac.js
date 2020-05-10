"use strict";

import { Collection } from './collection';
import { CollectionLoader } from './loaders';

import { notFound, isAjaxRequest } from './utils.js';
import { StatsTracker } from './statstracker.js';

import { API } from './api.js';

const CACHE_PREFIX = "wabac-";
const IS_AJAX_HEADER = "x-wabac-is-ajax-req";


// ===========================================================================
class SWCollections extends CollectionLoader
{
  constructor(prefixes) {
    super();
    this.prefixes = prefixes;
    this.colls = null;
    this.inited = null;
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
}


// ===========================================================================
class SWReplay {
  constructor() {
    this.prefix = self.registration ? self.registration.scope : '';

    this.replayPrefix = this.prefix;

    const sp = new URLSearchParams(self.location.search);

    const replayPrefixPath = sp.get("replayPrefix") || "wabac";

    if (replayPrefixPath) {
      this.replayPrefix += replayPrefixPath + "/";
    }

    this.staticPrefix = this.prefix + "static/";
    this.distPrefix = this.prefix + "dist/";

    const prefixes = {static: this.staticPrefix,
                      root: this.prefix,
                      main: this.replayPrefix
                     };

    this.collections = new SWCollections(prefixes);
    this.collections.loadAll(sp.get("dbColl"));

    this.api = new API(this.collections);
    this.apiPrefix = this.replayPrefix + "api/";

    this.allowRewrittenCache = sp.get("allowCache") ? true : false;

    this.stats = sp.get("stats") ? new StatsTracker() : null;

    self.addEventListener('install', (event) => {
      event.waitUntil(self.skipWaiting());
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(self.clients.claim());
      console.log("Activate!");
    });

    self.addEventListener('fetch', (event) => {
      const url = event.request.url;

      // if not on our domain, just pass through (loading handled in local worker)
      if (!url.startsWith(this.prefix)) {
        event.respondWith(this.defaultFetch(event.request));
        return;
      }

      // current domain, but not replay, check if should cache ourselves
      if (!url.startsWith(this.replayPrefix)) {
        // only cache: root page, ourself, staticPrefix and distPrefix
        if (url === this.prefix ||
            url === self.location.href || 
            url.startsWith(this.prefix + "?") || 
            url.startsWith(this.staticPrefix) || 
            url.startsWith(this.distPrefix)) {
          event.respondWith(this.handleOffline(event.request));
        } else {
          event.respondWith(this.defaultFetch(event.request));
        }
        return;
      }

      event.respondWith(this.getResponseFor(event.request, event));
    });

    self.addEventListener("message", (event) => {
      if (event.data.msg_type === "reload_all") {
        this.collections.loadAll();
      }
    });

    this.ensureCached(["/", "/static/wombat.js", "/static/wombatWorkers.js"]);
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
        response = notFound(request, "Sorry, this url was not caches for offline use");
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

    await this.collections.inited;

    let response = null;

    const isGet = (request.method === "GET");
    const getRequest = (isGet || !this.allowRewrittenCache) ? request : await this.toGetRequest(request);

    const isAjax = isAjaxRequest(request);
    const range = request.headers.get('range');

    try {
      if (!range) {
        response = await self.caches.match(getRequest);
        if (response && !!response.headers.get(IS_AJAX_HEADER) === isAjax) {
          return response;
        }
      }
    } catch (e) {
      response = null;
    }

    const collId = request.url.slice(this.replayPrefix.length).split("/", 1)[0];

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

        default:
          query = "____wabac_method=" + request.method.toLowerCase();
          const buff = await request.arrayBuffer();
          if (buff.byteLength > 0) {
            const text = new TextDecoder().decode(buff);
            query += "&" + btoa(text);
          }
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

