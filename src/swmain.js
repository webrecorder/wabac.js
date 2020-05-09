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

    const replayPrefixPath = sp.get("replayPrefix");

    if (replayPrefixPath) {
      this.replayPrefix += replayPrefixPath + "/";
    }

    this.staticPrefix = this.prefix + "static";

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
      // if not within replay prefix, just pass through
      if (!event.request.url.startsWith(this.replayPrefix)) {
        event.respondWith(this.defaultFetch(event.request));
        return;
      }

      event.respondWith(this.getResponseFor(event.request, event));
    });

    self.addEventListener("message", (event) => {
      if (event.data.msg_type === "reload_all") {
        this.collections.loadAll();
      }
    });
  }

  defaultFetch(request) {
    const opts = {};
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      opts.cache = 'default';
    }
    return self.fetch(request, opts);
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

