"use strict";

import { Collection } from './collection.js';
import { ArchiveDB } from './archivedb.js';

import { HARLoader } from './harloader';
import { WBNLoader } from './wbnloader';
import { WARCLoader } from './warcloader';

import { RemoteArchiveCache } from './remotearchive.js'

//import { LiveCache } from './live.js';
import { notFound, isAjaxRequest } from './utils.js';
import { StatsTracker } from './statstracker.js';

import { deleteDB, openDB } from 'idb/with-async-ittr.js';

const CACHE_PREFIX = "wabac-";
const IS_AJAX_HEADER = "x-wabac-is-ajax-req";


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

    this.collections = {};
    this._init_wait = this.initAllColls(sp.get("dbColl"));

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
  }

  async initAllColls(dbColls) {
    this.colldb = await openDB("collDB", 1, {
      upgrade: (db, oldV, newV, tx) => {
        db.createObjectStore("colls", {keyPath: "name"});
      }
    });

    for (const extraColl of dbColls.split(",")) {
      const parts = extraColl.split(":");
      if (parts.length === 2) {
        const config = {dbname: parts[1], sourceName: parts[1], decode: false};
        const collData = {name: parts[0], type: "archive", config};
        console.log("Adding Coll: " + JSON.stringify(collData));
        await this.colldb.put("colls", collData);
      }
    }

    const allColls = await this.colldb.getAll("colls");

    for (const data of allColls) {
      this.collections[data.name] = await this.loadColl(data);
    }

    return true;
  }

  async loadColl(data) {
    let store = null;

    switch (data.type) {
      case "archive":
        store = new ArchiveDB(data.config.dbname);
        await store.initing;
        break;

      case "remote":
        store = new RemoteArchiveCache(data.config);
        break;
    }

    if (!store) {
      return null;
    }

    const name = data.name;
    const config = data.config;

    const staticPrefix = this.staticPrefix;
    const prefix = this.replayPrefix;
    const rootPrefix = this.prefix;

    return new Collection({name, store, prefix, rootPrefix, staticPrefix, config});
  }

  async addCollection(data) {
    await this._init_wait;

    const name = data.name;

    let decode = false;
    let type = null;
    let config = {};

    if (data.files) {
      // TODO: multiple files
      const file = data.files[0];

      let loader = null;

      if (file.url) {
        const resp = await self.fetch(file.url);

        if (file.name.endsWith(".har")) {
          loader = new HARLoader(await resp.json());

        } else if (file.name.endsWith(".warc") || file.name.endsWith(".warc.gz")) {
          loader = new WARCLoader(await resp.arrayBuffer());
          decode = true;

        } else if (file.name.endsWith(".wbn")) {
          loader = new WBNLoader(await resp.arrayBuffer());
        } else {
          return null;
        }
        type = "archive";
        config.dbname = "db:" + name;
        config.sourceName = file.name;
        config.root = false;
        const db = new ArchiveDB(config.dbname);
        await db.initing;
        await loader.load(db);
        db.close();
      }
      
    } else if (data.remote) {
      type = "remote";
      config = data.remote;
      config.sourceName = config.replayPrefix;
    } else {
      return null;
    }

    config.decode = decode;

    const collData = {name, type, config};
    await this.colldb.add("colls", collData);
    this.collections[name] = await this.loadColl(collData);
    return this.collections[name];
  }

  async hasCollection(name) {
    await this._init_wait;

    return this.collections[name] != undefined;
  }

  async deleteCollection(name) {
    if (!await this.hasCollection(name)) {
      return false;
    }

    if (this.collections[name].config.dbname) {
      this.collections[name].store.close();
      await deleteDB(this.collections[name].config.dbname, {
        blocked(reason) {
          console.log("Unable to delete: " + reason);
        }
      });
    }

    await this.colldb.delete("colls", name);
    delete this.collections[name];
    self.caches.delete(CACHE_PREFIX + name);
    return true;
  }

  async _handleMessage(event) {
    switch (event.data.msg_type) {
      case "addColl":
      {
        const name = event.data.name; 
        let coll = null;

        if (await this.hasCollection(name)) {
          if (!event.data.skipExisting) {
            await this.deleteCollection(name);
            coll = await this.addCollection(event.data);
          }
        } else {
          coll = await this.addCollection(event.data);
        }

        if (!coll) {
          return;
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

        if (await this.hasCollection(name)) {
          await this.deleteCollection(name);
          this.doListAll(event.source);
        }
        break;
      }

      case "listAll":
        this.doListAll(event.source);
        break;
    }
  }

  async doListAll(source) {
    const msgData = [];
    for (const coll of Object.values(this.collections)) {
      const pageList = await coll.store.getAllPages();
  
      msgData.push({
        "name": coll.name,
        "prefix": coll.appPrefix,
        "pageList": pageList,
        "sourceName": coll.config.sourceName
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

