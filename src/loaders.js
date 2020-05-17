"use strict";

import { ArchiveDB } from './archivedb.js';
import { RemoteArchiveDB } from './remotearchivedb';
import { ZipRemoteArchiveDB } from './ziparchive';

import { HARLoader } from './harloader';
import { WBNLoader } from './wbnloader';
import { WARCLoader } from './warcloader';
import { CDXLoader, CDXFromWARCLoader } from './cdxloader';

import { createLoader } from './blockloaders';

import { RemoteProxySource, LiveAccess } from './remoteproxy';

import { deleteDB, openDB } from 'idb/with-async-ittr.js';


// Threshold size for switching to range requests 
const MAX_FULL_DOWNLOAD_SIZE = 25000000;

self.interruptLoads = {};


// ===========================================================================
class CollectionLoader
{
  constructor() {
    this.colldb = null;
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

  listAll() {
    return this.colldb.getAll("colls");
  }

  async loadColl(name) {
    const data = await this.colldb.get("colls", name);
    if (!data) {
      return null;
    }

    return await this._initColl(data);
  }

  async deleteColl(name) {
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
    const data = await this.colldb.get("colls", name);
    if (!data) {
      return false;
    }
    data.config.headers = newHeaders;
    await this.colldb.put("colls", data);
    return true;
  }

  async _initColl(data) {
    let store = null;

    switch (data.type) {
      case "archive":
        store = new ArchiveDB(data.config.dbname);
        break;

      case "remotewarc":
        if (data.config.singleFile) {
          const sourceLoader = createLoader(data.config.loadUrl || data.config.sourceUrl, data.config.headers, data.config.size, data.config.extra);
          store = new RemoteArchiveDB(data.config.dbname, sourceLoader);
        } else {
          store = new RemoteArchiveDB(data.config.dbname, data.config.remotePrefix, data.config.headers);
        }
        break;

      case "remotezip":
        const sourceLoader = createLoader(data.config.loadUrl || data.config.sourceUrl, data.config.headers, data.config.extra);
        store = new ZipRemoteArchiveDB(data.config.dbname, sourceLoader, data.config.extraConfig);
        break;

      case "remoteproxy":
        store = new RemoteProxySource(data.config);
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
        let coll = null;

        const progressUpdate = (percent, error) => {
          client.postMessage({
            "msg_type": "collProgress",
            name,
            percent,
            error
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

        this.doListAll(client);
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

    let decode = false;
    let type = null;
    let config = {root: false};
    let db = null;

    if (data.file) {
      const file = data.file;

      let loader = null;
      let resp = null;
      let abort = null;

      if (file.sourceUrl) {
        type = "archive";
        config.dbname = "db:" + name;

        let loadUrl = file.loadUrl || file.sourceUrl;

        if (!loadUrl.match(/[\w]+:\/\//)) {
          loadUrl = new URL(loadUrl, self.location.href).href;
        }

        config.loadUrl = loadUrl;
        config.sourceUrl = file.sourceUrl;

        config.sourceName = file.name || file.sourceUrl;
        config.sourceName = config.sourceName.slice(config.sourceName.lastIndexOf("/") + 1);

        config.headers = file.headers;
        config.size = typeof(file.size) === "number" ? file.size : null;
        config.extra = file.extra;
        config.extraConfig = data.extraConfig;

        const sourceLoader = createLoader(loadUrl, file.headers, file.size, config.extra);

        if (config.sourceName.endsWith(".wacz") || config.sourceName.endsWith(".zip")) {
          db = new ZipRemoteArchiveDB(config.dbname, sourceLoader, config.extraConfig);
          type = "remotezip";
          decode = true;
          // is its own loader
          loader = db;

          // do HEAD request only
          const result = await sourceLoader.doInitialFetch(true);
          resp = result.response;
        } else {
          const result = await sourceLoader.doInitialFetch();
          resp = result.response;
          abort = result.abort;
        }

        if (!sourceLoader.isValid) {
          const text = sourceLoader.length <= 1000 ? await resp.text() : "";
          progressUpdate(0, `\
Sorry, this URL could not be loaded.
Make sure this is a valid URL and you have access to this file.
Status: ${resp.status} ${resp.statusText}
Error Details:
${text}`);
          return;
        }

        if (!sourceLoader.length) {
          progressUpdate(0, `\
Sorry, this URL could not be loaded because the size of the file is not accessible.
Make sure this is a valid URL and you have access to this file.`);
          return;
        }

        const contentLength = sourceLoader.length;
        
        if (config.sourceName.endsWith(".har")) {
          loader = new HARLoader(await resp.json());

        } else if (config.sourceName.endsWith(".warc") || config.sourceName.endsWith(".warc.gz")) {
          if (contentLength < MAX_FULL_DOWNLOAD_SIZE || !sourceLoader.supportsRange) {
            loader = new WARCLoader(resp.body, abort, name);
          } else {
            loader = new CDXFromWARCLoader(resp.body, abort, name);
            type = "remotewarc";
            config.remotePrefix = loadUrl;
            config.singleFile = true;
            db = new RemoteArchiveDB(config.dbname, sourceLoader);
          }
          decode = true;

        } else if (config.sourceName.endsWith(".wbn")) {
          loader = new WBNLoader(await resp.arrayBuffer());

        } else if (config.sourceName.endsWith(".cdxj") || config.sourceName.endsWith(".cdx")) {
          config.remotePrefix = data.remotePrefix || loadUrl.slice(0, loadUrl.lastIndexOf("/") + 1);
          loader = new CDXLoader(resp.body, abort, name);
          decode = true;
          type = "remotewarc";
          db = new RemoteArchiveDB(config.dbname, config.remotePrefix);
        }

        if (!loader) {
          progressUpdate(0, `The ${config.sourceName} is not a known archive format that could be loaded.`);
          return;
        }

        if (!db) {
          db = new ArchiveDB(config.dbname);
        }
        await db.initing;

        try {
          config.metadata = await loader.load(db, progressUpdate, contentLength);
        } catch (e) {
          return false;
        }

        if (!config.metadata.size) {
          config.metadata.size = contentLength;
        }
      }
      
    } else if (data.remote) {
      type = "remoteproxy";
      config = data.remote;
      config.sourceName = config.replayPrefix;
    } else {
      progressUpdate(0, `Invalid Load Request`)
      return null;
    }

    config.decode = decode;
    config.onDemand = (type === "remotewarc" || type === "remotezip");

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