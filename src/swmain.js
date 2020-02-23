"use strict";

import { Collection } from './collection.js';
import { ArchiveDB } from './archivedb.js';
import { HARCache } from './harcache.js';
import { LiveCache } from './live.js';
import { RemoteArchiveCache } from './remotearchive.js'
import { WARCCache } from './warccache.js';
import { WarcParser } from './warcparse.js';
import { WebBundleCache } from './webbundle.js';
import { notFound, isAjaxRequest } from './utils.js';
import { StatsTracker } from './statstracker.js';

const CACHE_PREFIX = "wabac-";
const IS_AJAX_HEADER = "x-wabac-is-ajax-req";

class SWReplay {
  constructor(cacheTypes) {
    this.prefix = self.registration ? self.registration.scope : '';

    this.replayPrefix = this.prefix;

    const sp = new URLSearchParams(self.location.search);

    const replayPrefixPath = sp.get("replayPrefix");

    if (replayPrefixPath) {
      this.replayPrefix += replayPrefixPath + "/";
    }

    this.staticPrefix = this.prefix + "static";

    this.collections = {};

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
      event.respondWith(this.getResponseFor(event.request, event));
    });

    self.addEventListener("message", (event) => {
      this._handleMessage(event);
    });

    if (!cacheTypes) {
      cacheTypes = {"db": ArchiveDB,
                    "livecache": LiveCache
                   }
    }

    this.cacheTypes = cacheTypes;

    for (const source of Object.keys(this.cacheTypes)) {
      this._autoinitColl(sp.get(source + "Coll"), source);
    }
  }

  _autoinitColl(string, prop) {
    if (!string) return;

    for (const obj of string.split(",")) {
      const objProps = obj.split(":");
      if (objProps.length === 2) {
        const def = {type: prop,
                     name: objProps[0],
                     data: objProps[1]};

        this.initCollection(def).then(() => {
          console.log(`${prop} Collection Inited: ${objProps[0]} = ${objProps[1]}`);
        });
      }
    }
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
    let decode = false;

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
          decode = true;

          const parser = new WarcParser();
          await parser.parse(ab, cache);
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

    // extra cache types
    for (const source of Object.keys(this.cacheTypes)) {
      if (data.type === source) {
        cache  = new this.cacheTypes[source](data.data);
        sourceName = source + ":" + data.name;
      }
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

    const coll = new Collection({name, cache, prefix, rootPrefix, rootColl, sourceName, staticPrefix, decode});
    this.collections[name] = coll;
    return coll;
  }

  doListAll(source) {
    let msgData = [];
    for (const coll of Object.values(this.collections)) {
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

/*
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
*/
    for (const coll of Object.values(this.collections)) {
      response = await coll.handleRequest(request, event);
      if (!response) {
        continue;
      }

      if (this.stats) {
        this.stats.updateStats(response, request, event);
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

