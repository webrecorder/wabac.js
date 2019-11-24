"use strict";

import { Collection } from './collection.js';
import { HARCache } from './harcache.js';
import { RemoteArchiveCache } from './remotearchive.js'
import { WARCCache } from './warccache.js';
import { WarcParser } from './warcparse.js';
import { WebBundleCache } from './webbundle.js';
import { notFound } from './utils.js';
import { StatsTracker } from './statstracker.js';

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

      case "removeColl":
        if (this.collections[event.data.name]) {
          delete this.collections[event.data.name];
          this.doListAll(event.source);
        }
        break;

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
      return await this.defaultFetch(request);
    }

    let response = null;

    try {
      response = await self.caches.match(request);
      if (response) {
        return response;
      }
    } catch (e) {
      response = null;
    }

    try {
      response = await this.defaultFetch(request);
      if (response && response.status < 400) {
        return response;
      }
    } catch (e) {
      response = null;
    }

    for (let coll of Object.values(this.collections)) {
      response = await coll.handleRequest(request);
      if (response) {
        if (this.stats) {
          this.stats.updateStats(response, request, event);
        }
        return response;
      }
    }

    if (this.stats && request.url.startsWith(this.replayPrefix + "stats.json")) {
      response = await this.stats.getStats(event);
      return response;
    }

    return notFound(request);
  }
}

export { SWReplay };

