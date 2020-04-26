"use strict";

import { ArchiveDB } from './archivedb.js';
import { RemoteArchiveDB } from './remotearchivedb';
import { ZipRemoteArchiveDB } from './ziparchive';

import { HARLoader } from './harloader';
import { WBNLoader } from './wbnloader';
import { WARCLoader } from './warcloader';
import { CDXLoader, CDXFromWARCLoader } from './cdxloader';

import { RemoteProxySource, LiveAccess } from './remoteproxy';

import { deleteDB, openDB } from 'idb/with-async-ittr.js';

import { AsyncIterReader } from 'warcio';


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

    // live -- can only work if CORS disabled, eg. in extensions
    await this.colldb.put("colls", {name: "live", type: "live",
      config: {prefix: "https://cf-worker.webrecorder.workers.dev/proxy/"}});

    const allColls = await this.listAll();

    const promises = allColls.map((data) => this._initColl(data));

    await Promise.all(promises);

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

  async _initColl(data) {
    let store = null;

    switch (data.type) {
      case "archive":
        store = new ArchiveDB(data.config.dbname);
        break;

      case "remotewarc":
        store = new RemoteArchiveDB(data.config.dbname, data.config.remotePrefix);
        break;

      case "remotezip":
        const sourceReader = createReader(data.config.sourceUrl, data.config.headers);
        store = new ZipRemoteArchiveDB(data.config.dbname, sourceReader);
        break;

      case "remoteproxy":
        store = new RemoteProxySource(data.config);
        break;

      case "live":
        store = new LiveAccess(data.config.prefix);
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

        if (await this.hasCollection(name)) {
          if (!event.data.skipExisting) {
            await this.deleteCollection(name);
            await this.addCollection(event.data, progressUpdate);
          } else {
            //coll = this.collections[name];
            //return;
          }
        } else {
          await this.addCollection(event.data, progressUpdate);
        }

        // if (!coll) {
        //   return;
        // }

        client.postMessage({
          "msg_type": "collAdded",
          //"prefix": coll.prefix,
          "name": name
        });

        this.doListAll(client);
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

      if (file.sourceUrl) {
        type = "archive";
        config.dbname = "db:" + name;
        const sourceUrl = new URL(file.sourceUrl, self.location.href).href;

        config.sourceUrl = sourceUrl;
        config.sourceId = file.sourceId || sourceUrl;
        config.sourceName = file.name || sourceUrl;
        config.displayName = file.displayName || config.sourceName;
        config.headers = file.headers;

        const sourceReader = createReader(sourceUrl, file.headers);

        if (config.sourceName.endsWith(".wacz") || config.sourceName.endsWith(".zip")) {
          db = new ZipRemoteArchiveDB(config.dbname, sourceReader);
          type = "remotezip";
          decode = true;
          // is its own loader
          loader = db;

          // do HEAD request only
          const result = await sourceReader.doInitialFetch(true);
          resp = result.response;
        } else {
          const result = await sourceReader.doInitialFetch();
          resp = result.response;
        }

        if (!sourceReader.isValid) {
          progressUpdate(0, `Sorry, this URL could not be loaded. Make sure this is a valid URL (Status ${resp.status} - ${resp.statusText})`);
          return;
        }
        
        if (config.sourceName.endsWith(".har")) {
          loader = new HARLoader(await resp.json());

        } else if (config.sourceName.endsWith(".warc") || config.sourceName.endsWith(".warc.gz")) {
          if (!sourceReader.supportsRange) {
            loader = new WARCLoader(resp.body);
          } else {
            loader = new CDXFromWARCLoader(resp.body);
            type = "remotewarc";
            config.remotePrefix = file.sourceUrl;
            db = new RemoteArchiveDB(config.dbname, config.remotePrefix);
          }
          decode = true;

        } else if (config.sourceName.endsWith(".wbn")) {
          loader = new WBNLoader(await resp.arrayBuffer());

        } else if (config.sourceName.endsWith(".cdxj") || config.sourceName.endsWith(".cdx")) {
          config.remotePrefix = data.remotePrefix || file.sourceUrl.slice(0, file.sourceUrl.lastIndexOf("/") + 1);
          loader = new CDXLoader(new AsyncIterReader(resp.body.getReader()));
          decode = true;
          type = "remotewarc";
          db = new RemoteArchiveDB(config.dbname, config.remotePrefix);

        } else if (!type) {
          return null;
        }

        if (!db) {
          db = new ArchiveDB(config.dbname);
        }
        await db.initing;

        const contentLength = sourceReader.length;
        config.metadata = await loader.load(db, progressUpdate, contentLength);
        if (!config.metadata.size) {
          config.metadata.size = contentLength;
        }
      }
      
    } else if (data.remote) {
      type = "remoteproxy";
      config = data.remote;
      config.sourceName = config.replayPrefix;
    } else {
      return null;
    }

    config.decode = decode;

    const collData = {name, type, config};
    await this.colldb.add("colls", collData);
    //return await this.loadColl(collData, db);
  }

  async deleteCollection(name) {
    const result = await this.colldb.getKey("colls", name);
    if (!result) {
      return false;
    }

    try {
      await deleteDB(result.config.dbname, {
        blocked(reason) {
          console.log("Unable to delete: " + reason);
        }
      });
    } catch (e) {
      console.warn(e);
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

// ===========================================================================
function createReader(url, headers) {
  if (url.startsWith("blob:")) {
    return new BlobReader(url);
  } else if (url.startsWith("http:") || url.startsWith("https:")) {
    return new HttpRangeReader(url, headers);
  } else {
    throw new Error("Invalid URL: " + url);
  }
}


// ===========================================================================
class HttpRangeReader
{
  constructor(url, headers, length = null, supportsRange = false) {
    this.url = url;
    this.headers = headers || {};
    this.length = length;
    this.supportsRange = supportsRange;
    this.isValid = false;
  }

  async doInitialFetch(tryHead) {
    this.headers["Range"] = "bytes=0-";
    this.isValid = false;
    let abort = null;
    let response = null;

    if (tryHead) {
      try {
        response = await fetch(this.url, {headers: this.headers, method: "HEAD"});
        if (response.status === 200 || response.status == 206) {
          this.supportsRange = (response.status === 206);
          this.isValid = true;
          this.length = Number(response.headers.get("Content-Length"));
        }
      } catch(e) {

      }
    }

    if (!this.isValid) {
      abort = new AbortController();
      const signal = abort.signal;
      response = await fetch(this.url, {headers: this.headers, signal});
      this.supportsRange = (response.status === 206);
      this.isValid = (response.status === 206 || response.status === 200);
      this.length = Number(response.headers.get("Content-Length"));
    }

    return {response, abort};
  }

  async getLength() {
    if (this.length === null) {
      const {response, abort} = await this.doInitialFetch(true);
      if (abort) {
        abort();
      }
    }
    return this.length;
  }

  async getRange(offset, length, streaming = false, signal) {
    if (this.length === null) {
      await this.getLength();
    }

    const options = {signal, headers: {
      "Range": `bytes=${offset}-${offset + length - 1}`
    }};

    let resp = null;

    try {
      resp = await fetch(this.url, options);
    } catch(e) {
      console.log(e);
    }

    if (streaming) {
      return resp.body;
    } else {
      return new Uint8Array(await resp.arrayBuffer());
    }
  } 
}


// ===========================================================================
class BlobReader
{
  constructor(url, blob = null) {
    this.url = url;
    this.blob = blob;
  }

  get supportsRange() {
    return false;
  }

  get length() {
    return (this.blob ? this.blob.size : 0);
  }

  get isValid() {
    return !!this.blob;
  }

  async doInitialFetch() {
    let response = await fetch(this.url);
    this.blob = await response.blob();

    const abort = new AbortController();
    const signal = abort.signal;
    response = await fetch(this.url, {signal});

    return {response, abort};
  }

  async getLength() {
    if (!this.blob) {
      let response = await fetch(this.url);
      this.blob = await response.blob();
    }
    return this.blob.size;
  }

  async getRange(offset, length, streaming = false, signal) {
    if (!this.blob) {
      await this.getLength();
    }

    const blobChunk = this.blob.slice(offset, offset + length, "application/octet-stream");

    if (streaming) {
      return blobChunk.stream ? blobChunk.stream() : this.getReadableStream(blobChunk);
    } else {
      try {
        const ab = blobChunk.arrayBuffer ? await blobChunk.arrayBuffer() : await this.getArrayBuffer(blobChunk);
        return new Uint8Array(ab);
      } catch(e) {
        console.log("error reading blob", e);
        return null;
      }
    }
  }

  getArrayBuffer(blob) {
    return new Promise((resolve) => {
      let fr = new FileReader();
      fr.onloadend = () => {
        resolve(fr.result);
      };
      fr.readAsArrayBuffer(blob);
    });
  }

  async getReadableStream(blob) {
    const ab = await this.getArrayBuffer(blob);

    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(ab));
        controller.close();
      }
    });
  }
}

export { CollectionLoader, WorkerLoader, createReader };