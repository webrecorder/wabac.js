"use strict";

import { openDB } from 'idb/with-async-ittr.js';
import { tsToSec, tsToDate, getTS, makeNewResponse, makeHeaders } from './utils';
import { compareUrls } from './fuzzymatcher';


// ===========================================================================
class ArchiveDB {
  constructor(name) {
    this.name = name;
    this.db = null;
    this.initing = this.init();
    this.version = 1;

    this.repeats = {};
  }

  async init() {
    this.db = await openDB(this.name, this.version, {
      upgrade: (db, oldV, newV, tx) => this._initDB(db, oldV, newV, tx)
    });
  }

  _initDB(db, oldV, newV, tx) {
    const pageStore = db.createObjectStore("pages", { keyPath: "id" });
    pageStore.createIndex("url", "url");
    pageStore.createIndex("date", "date");

    const urlStore = db.createObjectStore("resources", { keyPath: ["url", "ts"] });
    urlStore.createIndex("pageId", "pageId");
    urlStore.createIndex("ts", "ts");

    if (newV === 2) {
      urlStore.createIndex("pageMime", ["page", "mime"]);
    }
  }

  async addPage(data) {
    if (data.id) {
      return await this.db.put("pages", data);
    } else {
      return await this.db.add("pages", data);
    }
  }

  async getAllPages() {
    return await this.db.getAllFromIndex("pages", "date");
  }

  async addUrl(data) {
    return await this.db.add("resources", data);
  }

  _repeatCountFor(event, url, method) {
    if (method !== "POST") {
      return 0;
    }

    if (event.replacesClientId) {
      delete this.repeats[event.replacesClientId];
    }

    const id = event.resultingClientId || event.clientId;
    if (!id) {
      return 0;
    }

    if (this.repeats[id] === undefined) {
      this.repeats[id] = {};
    }

    if (this.repeats[id][url] === undefined) {
      this.repeats[id][url] = 0;
    } else {
      this.repeats[id][url]++;
    }

    return this.repeats[id][url];
  }

  async match(request, rwPrefix, event) {
    const datetime = tsToDate(request.timestamp).getTime();

    let skip = this._repeatCountFor(event, request.url, request.method);

    let result = await this.lookupUrl(request.url, datetime, skip);

    const fuzzySearch = false;

    if (!result && fuzzySearch) {
      result = await this.lookupQueryPrefix(request.url);
    }

    if (!result) {
      return null;
    }

    if (result.mime === "fuzzy") {
      skip = this._repeatCountFor(event, request.url, request.method);
      result = await this.lookupUrl(result.original, datetime, skip);
      if (!result) {
        return null;
      }
    }

    const status = result.status;
    const statusText = result.statusText;
    const headers = makeHeaders(result.respHeaders);

    const date = new Date(result.ts);

    return makeNewResponse(result.payload, {status, statusText, headers}, getTS(date.toISOString()), date);
  }

  async lookupUrl(url, datetime, skip = 0) {
    const tx = this.db.transaction("resources", "readonly");

    if (skip > 0) {
      console.log(`Skip ${skip} for ${url}`);
    }

    if (datetime) {
      const res = await tx.store.get([url, datetime]);
      if (res) {
        return res;
      }
    }

    let lastValue = null;

    for await (const cursor of tx.store.iterate(this.getLookupRange(url))) {
      if (lastValue && cursor.value.ts > datetime) {
        if (skip == 0) {
          const diff = cursor.value.ts - datetime;
          const diffLast = datetime - lastValue.ts;
          return diff < diffLast ? cursor.value : lastValue;
        } else {
          skip--;
        }
      }
      lastValue = cursor.value;
    }

    return lastValue;
  }

  async lookupQueryPrefix(url) {
    const tx = this.db.transaction("resources", "readonly");

    let results = [];

    let urlNoQ = url.split("?", 1)[0] + "?";

    for await (const cursor of tx.store.iterate(this.getLookupRange(urlNoQ, "prefix"))) {
      results.push(cursor.value);
    }

    if (!results.length) {
      return null;
    }

    const result = compareUrls(url, results);
    if (result) {
      console.log(`Fuzz: ${result.result.url} <-> ${url}`);
    }
    return result.result;
  }


  async resourcesByPage(pageId) {
    return this.db.getAllFromIndex("resources", "pageId", pageId);
  }

  async deletePageResources(pageId) {
    const tx = this.db.transaction("resources", "readwrite");

    let cursor = await tx.store.index("pageId").openKeyCursor(pageId);

    while (cursor) {
      tx.store.delete(cursor.primaryKey);

      cursor = await cursor.continue();
    }

    await tx.done;
  }

  getLookupRange(url, type) {
    switch (type) {
      case "prefix":
        const upper = url;
        upper[upper.length - 1] = String.fromCharCode(url.charCodeAt(url.length - 1) + 1);
        return IDBKeyRange.bound([url], [upper], false, true);

      case "host":
        const origin = new URL(url).origin;
        return IDBKeyRange.bound([origin + "/"], [origin + "0"], false, true);

      case "exact":
      default:
        return IDBKeyRange.bound([url], [url + "!"], false, true);
    }
  }
}


// ===========================================================================
class WarcIndexer {
  constructor(collDB) {
    this.parser = new WarcParser();
    this.collDB = collDB;
  }

  index(file) {
    this.parser.parse(file, this.buildCdx.bind(this)).then(function () {
      console.log("all done")
    });
  }

  async buildCdx(record, cdx) {
    cdx.url = record.warcTargetURI;
    cdx.timestamp = record.warcDate.replace(/[^\d]/g, "");
    let status = record.httpInfo && record.httpInfo.statusCode;
    if (status) {
      cdx.status = record.httpInfo.statusCode;
    }
    cdx.type = record.warcType;
    cdx.digest = record.warcPayloadDigest;
    cdx.urlKey = cdx.url + " " + cdx.timestamp;

    await this.collDB.writeTransaction().put(cdx);
    console.log(cdx);
  }
}


export { ArchiveDB };


