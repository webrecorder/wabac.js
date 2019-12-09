"use strict";

import { Collection } from './collection.js';
import { HARCache } from './harcache.js';
import { RemoteArchiveCache } from './remotearchive.js'
import { WARCCache } from './warccache.js';
import { WarcParser } from './warcparse.js';
import { WebBundleCache } from './webbundle.js';
import { notFound, isAjaxRequest } from './utils.js';
import { StatsTracker } from './statstracker.js';

const CACHE_PREFIX = "wabac-";
const IS_AJAX_HEADER = "x-wabac-is-ajax-req";

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

    this.collections = {};

    this.allowCache = true;

    this.stats = sp.get("stats") ? new StatsTracker() : null;

    self.addEventListener('install', (event) => {
      event.waitUntil(self.skipWaiting());
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(self.clients.claim());
      console.log("Activate!");
    });

    self.addEventListener('fetch', (event) => {
      event.respondWith(this.getResponseFor(event.request, event));
    });

    self.addEventListener("message", (event) => {
      this._handleMessage(event);
    });
  }

  async _handleMessage(event) {
    switch (event.data.msg_type) {
      case "addColl":
      {
        const name = event.data.name;

        let coll = this.collections[name];

        if (!coll || !event.data.skipExisting) {
          coll = await this.initCollection(event.data);

          if (!coll) {
            return;
          }

          this.collections[name] = coll;
        }

        event.source.postMessage({
          "msg_type": "collAdded",
          "prefix": coll.prefix,
          "name": name
        });

        this.doListAll(event.source);
        break;
      }

      case "removeColl":
      {
        const name = event.data.name;

        if (this.collections[name]) {
          delete this.collections[name];
          this.doListAll(event.source);
          self.caches.delete(CACHE_PREFIX + name);
        }
        break;
      }

      case "listAll":
        this.doListAll(event.source);
        break;
    }
  }

  async initCollection(data) {
    let cache = null;
    let sourceName = null;

    if (data.files) {
      // TODO: multiple files
      let file = data.files[0];

      if (file.url) {
        const resp = await self.fetch(file.url);

        if (file.name.endsWith(".har")) {
          const har = await resp.json();
          cache = new HARCache(har);

        } else if (file.name.endsWith(".warc") || file.name.endsWith(".warc.gz")) {
          const ab = await resp.arrayBuffer();
          cache = new WARCCache();

          const parser = new WarcParser();
          await parser.parse(ab, cache.index.bind(cache));
        } else if (file.name.endsWith(".wbn")) {
          const ab = await resp.arrayBuffer();
          cache = new WebBundleCache(ab);
        }
        sourceName = file.name;
      }
    } else if (data.remote) {
      cache = new RemoteArchiveCache(data.remote);
      sourceName = data.remote.replayPrefix;
    }

    if (!cache) {
      console.log("No Valid Cache!");
      return null;
    }

    const rootColl = data.root;
    const name = data.name;
    const staticPrefix = this.staticPrefix;
    const prefix = this.replayPrefix;
    const rootPrefix = this.prefix;

    return new Collection({name, cache, prefix, rootPrefix, rootColl, sourceName, staticPrefix});
  }

  doListAll(source) {
    let msgData = [];
    for (let coll of Object.values(this.collections)) {
      msgData.push({
        "name": coll.name,
        "prefix": coll.appPrefix,
        "pageList": coll.cache.pageList,
        "sourceName": coll.sourceName
      });
    }
    source.postMessage({ "msg_type": "listAll", "colls": msgData });
  }

  async defaultFetch(request) {
    let opts = {};
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      opts.cache = 'default';
    }
    return await self.fetch(request, opts);
  }

  async getResponseFor(request, event) {
    // if not within replay prefix, just pass through
    if (!request.url.startsWith(this.replayPrefix)) {

      if (this.stats && request.url.startsWith(this.prefix + "stats.json")) {
        return await this.stats.getStats(event);
      }

      return await this.defaultFetch(request);
    }

    let response = null;

    const isGet = (request.method === "GET");
    const getRequest = (isGet || !this.allowCache) ? request : await this.toGetRequest(request);

    const isAjax = isAjaxRequest(request);

    try {
      response = await self.caches.match(getRequest);
      if (response && !!response.headers.get(IS_AJAX_HEADER) === isAjax) {
        return response;
      }
    } catch (e) {
      response = null;
    }

    if (isGet) {
      try {
        response = await this.defaultFetch(request);
        if (response && response.status < 400) {
          return response;
        }
      } catch (e) {
        response = null;
      }
    }

    for (let coll of Object.values(this.collections)) {
      response = await coll.handleRequest(request);
      if (!response) {
        continue;
      }

      if (this.stats) {
        this.stats.updateStats(response, request, event);
      }

      if (this.allowCache && response.status === 200) {
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
            query += "&" + atob(text);
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

