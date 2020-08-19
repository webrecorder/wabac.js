"use strict";

import { ArchiveDB } from './archivedb.js';
import { RemoteSourceArchiveDB, RemotePrefixArchiveDB } from './remotearchivedb';
import { ZipRemoteArchiveDB } from './ziparchive';

import { HARLoader } from './harloader';
import { WBNLoader } from './wbnloader';
import { WARCLoader } from './warcloader';
import { CDXLoader, CDXFromWARCLoader } from './cdxloader';

import { createLoader } from './blockloaders';

import { RemoteWARCProxy, RemoteProxySource, LiveAccess } from './remoteproxy';

import { deleteDB, openDB } from 'idb/with-async-ittr.js';
import { Canceled } from './utils.js';


// Threshold size for switching to range requests 
const MAX_FULL_DOWNLOAD_SIZE = 25000000;

self.interruptLoads = {};


// ===========================================================================
class CollectionLoader
{
  constructor() {
    this.colldb = null;
    this.root = null;
    this._init_db = this._initDB();
  }

  async _initDB() {
    this.colldb = await openDB("collDB", 1, {
      upgrade: (db, oldV, newV, tx) => {
        db.createObjectStore("colls", {keyPath: "name"});
      }
    });
  }

  async loadAll(dbColls) {
    await this._init_db;

    if (dbColls) {
      for (const extraColl of dbColls.split(",")) {
        const parts = extraColl.split(":");
        if (parts.length === 2) {
          const config = {dbname: parts[1], sourceName: parts[1], decode: false};
          const collData = {name: parts[0], type: "archive", config};
          console.log("Adding Coll: " + JSON.stringify(collData));
          await this.colldb.put("colls", collData);
        }
      }
    }

    try {
      const allColls = await this.listAll();

      const promises = allColls.map((data) => this._initColl(data));
  
      await Promise.all(promises);
    } catch (e) {
      console.warn(e.toString());
    }

    return true;
  }

  async listAll() {
    await this._init_db;
    return await this.colldb.getAll("colls");
  }

  async loadColl(name) {
    await this._init_db;
    const data = await this.colldb.get("colls", name);
    if (!data) {
      return null;
    }

    return await this._initColl(data);
  }

  async deleteColl(name) {
    await this._init_db;
    const data = await this.colldb.get("colls", name);
    if (!data) {
      return false;
    }
    if (data.config.dbname) {
      await deleteDB(data.config.dbname, {
        blocked(reason) {
          console.log(`Unable to delete ${data.config.dbname}: ${reason}`);
        }
      });
    }
    await this.colldb.delete("colls", name);
  }

  async updateAuth(name, newHeaders) {
    await this._init_db;
    const data = await this.colldb.get("colls", name);
    if (!data) {
      return false;
    }
    data.config.headers = newHeaders;
    await this.colldb.put("colls", data);
    return true;
  }

  async updateSize(name, size, dedupSize) {
    await this._init_db;
    const data = await this.colldb.get("colls", name);
    if (!data) {
      return false;
    }

    data.config.loadSize = (data.config.loadSize || 0) + size;
    data.config.dedupSize = (data.config.dedupSize || 0) + dedupSize;
    await this.colldb.put("colls", data);
  }

  async _initColl(data) {
    let store = null;
    let sourceLoader = null;

    switch (data.type) {
      case "archive":
        store = new ArchiveDB(data.config.dbname);
        break;

      case "remotesource":
        sourceLoader = createLoader(data.config.loadUrl, data.config.headers, data.config.size, data.config.extra);
        store = new RemoteSourceArchiveDB(data.config.dbname, sourceLoader, data.config.noCache);
        break;

      case "remoteprefix":
        store = new RemotePrefixArchiveDB(data.config.dbname, data.config.remotePrefix, data.config.headers, data.config.noCache);
        break;        

      case "remotezip":
        sourceLoader = createLoader(data.config.loadUrl || data.config.sourceUrl, data.config.headers, data.config.extra);
        store = new ZipRemoteArchiveDB(data.config.dbname, sourceLoader, data.config.extraConfig, data.config.noCache, data.config);
        break;

      case "remoteproxy":
        //TODO remove?
        store = new RemoteProxySource(data.config);
        break;

      case "remotewarcproxy":
        store = new RemoteWARCProxy(data.config);
        break;

      case "live":
        store = new LiveAccess(data.config.prefix, data.config.proxyPathOnly, data.config.isLive);
        break;
    }

    if (!store) {
      console.log("no store found: " + data.type);
      return null;
    }

    if (store.initing) {
      await store.initing;
    }

    const name = data.name;
    const config = data.config;

    if (data.config.root) {
      this.root = name;
    }

    return this._createCollection({name, store, config});
  }

  _createCollection(opts) {
    return opts;
  }
}

// ===========================================================================
class WorkerLoader extends CollectionLoader
{
  constructor(worker) {
    super();
    this.registerListener(worker);
  }

  async hasCollection(name) {
    await this._init_db;

    return await this.colldb.getKey("colls", name) != null;
  }

  registerListener(worker) {
    worker.addEventListener("message", event => this._handleMessage(event));
  }

  async _handleMessage(event) {
    await this._init_db;

    const client = event.source || self;

    switch (event.data.msg_type) {
      case "addColl":
      {
        const name = event.data.name; 

        const progressUpdate = (percent, error, currentSize, totalSize) => {
          client.postMessage({
            "msg_type": "collProgress",
            name,
            percent,
            error,
            currentSize,
            totalSize
          });
        };

        let res;

        try {
          if (await this.hasCollection(name)) {
            if (!event.data.skipExisting) {
              await this.deleteCollection(name);
              res = await this.addCollection(event.data, progressUpdate);
            } else {
              res = true;
              //coll = this.collections[name];
              //return;
            }
          } else {
            res = await this.addCollection(event.data, progressUpdate);
          }
  
          if (!res) {
            return;
          }
        } catch (e) {
          console.warn(e);
          progressUpdate(0, "An unexpected error occured: " + e.toString());
          return;
        }

        client.postMessage({
          "msg_type": "collAdded",
          //"prefix": coll.prefix,
          "name": name
        });

        //this.doListAll(client);
        break;
      }

      case "cancelLoad":
      {
        const name = event.data.name;

        const p = new Promise((resolve) => self.interruptLoads[name] = resolve);

        await p;

        await this.deleteCollection(name);

        delete self.interruptLoads[name];

        break;
      }

      case "removeColl":
      {
        const name = event.data.name;

        if (await this.hasCollection(name)) {
          await this.deleteCollection(name);
          this.doListAll(client);
        }
        break;
      }

      case "listAll":
        this.doListAll(client);
        break;
    }
  }

  async doListAll(client) {
    const msgData = [];
    const allColls = await this.listAll();

    for (const coll of allColls) {

      //const pageList = await coll.store.getAllPages();
  
      msgData.push({
        "name": coll.name,
        "prefix": coll.name,
        "pageList": [],
        "sourceName": coll.config.sourceName
      });
    }
    client.postMessage({ "msg_type": "listAll", "colls": msgData });
  }
  
  async addCollection(data, progressUpdate) {
    const name = data.name;

    let type = null;
    let config = {root: data.root || false};
    let db = null;

    const file = data.file;

    if (!file || !file.sourceUrl) {
      progressUpdate(0, `Invalid Load Request`);
      return false;
    }

    if (file.sourceUrl.startsWith("proxy:")) {
      config.sourceUrl = file.sourceUrl.slice("proxy:".length);
      config.extraConfig = data.extraConfig;
      config.topTemplateUrl = data.topTemplateUrl;
      type = "remotewarcproxy";

    } else {
      let loader = null;

      type = "archive";
      config.dbname = "db:" + name;

      let loadUrl = file.loadUrl || file.sourceUrl;

      if (!loadUrl.match(/[\w]+:\/\//)) {
        loadUrl = new URL(loadUrl, self.location.href).href;
      }

      config.decode = true;
      config.onDemand = false;
      config.loadUrl = loadUrl;
      config.sourceUrl = file.sourceUrl;

      config.sourceName = file.name || file.sourceUrl;
      config.sourceName = config.sourceName.slice(config.sourceName.lastIndexOf("/") + 1);

      config.headers = file.headers;
      config.size = typeof(file.size) === "number" ? file.size : null;
      config.extra = file.extra;
      config.extraConfig = data.extraConfig;
      config.noCache = loadUrl.startsWith("file:") || file.noCache;

      const sourceLoader = createLoader(loadUrl, file.headers, file.size, config.extra, file.blob);

      let tryHeadOnly = false;

      if (config.sourceName.endsWith(".wacz") || config.sourceName.endsWith(".zip")) {
        db = new ZipRemoteArchiveDB(config.dbname, sourceLoader, config.extraConfig, config.noCache, config);
        type = "remotezip";
        // is its own loader
        loader = db;

        // do HEAD request only
        tryHeadOnly = true;
      }
      
      let {abort, response, stream} = await sourceLoader.doInitialFetch(tryHeadOnly);
      stream = stream || response.body;

      if (!sourceLoader.isValid) {
        const text = sourceLoader.length <= 1000 ? await response.text() : "";
        progressUpdate(0, `\
Sorry, this URL could not be loaded.
Make sure this is a valid URL and you have access to this file.
Status: ${response.status} ${response.statusText}
Error Details:
${text}`);
        if (abort) {
          abort.abort();
        }
        return false;
      }

      if (!sourceLoader.length) {
        progressUpdate(0, `\
Sorry, this URL could not be loaded because the size of the file is not accessible.
Make sure this is a valid URL and you have access to this file.`);
        if (abort) {
          abort.abort();
        }
        return false;
      }

      const contentLength = sourceLoader.length;

      if (config.sourceName.endsWith(".warc") || config.sourceName.endsWith(".warc.gz")) {
        if (contentLength < MAX_FULL_DOWNLOAD_SIZE || !sourceLoader.canLoadOnDemand) {
          loader = new WARCLoader(stream, abort, name);
        } else {
          loader = new CDXFromWARCLoader(stream, abort, name);
          type = "remotesource";
          db = new RemoteSourceArchiveDB(config.dbname, sourceLoader, config.noCache);
        }

      } else if (config.sourceName.endsWith(".cdxj") || config.sourceName.endsWith(".cdx")) {
        config.remotePrefix = data.remotePrefix || loadUrl.slice(0, loadUrl.lastIndexOf("/") + 1);
        loader = new CDXLoader(stream, abort, name);
        type = "remoteprefix";
        db = new RemotePrefixArchiveDB(config.dbname, config.remotePrefix, config.headers, config.noCache);
      
      } else if (config.sourceName.endsWith(".wbn")) {
        //todo: fix
        loader = new WBNLoader(await response.arrayBuffer());
        config.decode = false;

      } else if (config.sourceName.endsWith(".har")) {
        //todo: fix
        loader = new HARLoader(await response.json());
        config.decode = false;
      }

      if (!loader) {
        progressUpdate(0, `The ${config.sourceName} is not a known archive format that could be loaded.`);
        if (abort) {
          abort.abort();
        }
        return false;
      }

      if (!db) {
        db = new ArchiveDB(config.dbname);
      }
      await db.initing;

      config.onDemand = sourceLoader.canLoadOnDemand;

      try {
        config.metadata = await loader.load(db, progressUpdate, contentLength);
      } catch (e) {
        if (!(e instanceof Canceled)) {
          progressUpdate(0, `Unexpected Loading Error: ${e.toString()}`);
        }
        return false;
      }

      if (!config.metadata.size) {
        config.metadata.size = contentLength;
      }
    }

    config.ctime = new Date().getTime();

    const collData = {name, type, config};
    await this.colldb.add("colls", collData);
    return true;
  }

  async deleteCollection(name) {
    const dbname = "db:" + name;

    try {
      await deleteDB(dbname, {
        blocked(reason) {
          console.log("Unable to delete: " + reason);
        }
      });
    } catch (e) {
      console.warn(e);
      return false;
    }

    /*
    if (this.collections[name].config.dbname) {
      this.collections[name].store.close();
      await deleteDB(this.collections[name].config.dbname, {
        blocked(reason) {
          console.log("Unable to delete: " + reason);
        }
      });
    }*/

    await this.colldb.delete("colls", name);
    //delete this.collections[name];
    //self.caches.delete(CACHE_PREFIX + name);
    return true;
  }
}


export { CollectionLoader, WorkerLoader };