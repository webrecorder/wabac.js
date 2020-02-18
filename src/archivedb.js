"use strict";

import { openDB } from 'idb/with-async-ittr.js';
import { tsToSec, tsToDate, getTS, makeNewResponse, makeHeaders } from './utils';


// ===========================================================================
class ArchiveDB {
  constructor(name) {
    this.name = name;
    this.db = null;
    this.initing = this.init();
  }

  async init() {
    this.db = await openDB(this.name, 1, {
      upgrade(db, oldVersion, newVersion, transaction) {
        const pageStore = db.createObjectStore("pages", { keyPath: "id" });
        pageStore.createIndex("url", "url");
        pageStore.createIndex("date", "date");

        const urlStore = db.createObjectStore("resources", { keyPath: ["url", "ts"] });
        urlStore.createIndex("pageId", "pageId");
        urlStore.createIndex("mime", "mime");
      }
    });
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

  async match(request) {
    const datetime = tsToDate(request.timestamp).getTime();

    let result = await this.lookupUrl(request.url, datetime);

    if (!result) {
      return null;
    }

    if (result.mime === "fuzzy") {
      result = await this.lookupUrl(result.original, datetime);
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

  async lookupUrl(url, datetime) {
    const tx = this.db.transaction("resources", "readonly");

    if (datetime) {
      const res = await tx.store.get([url, datetime]);
      if (res) {
        return res;
      }
    }

    let lastValue = null;

    for await (const cursor of tx.store.iterate(this.getLookupRange(url))) {
      if (lastValue && cursor.value.ts > datetime) {
        const diff = cursor.value.ts - datetime;
        const diffLast = datetime - lastValue.ts;
        return diff < diffLast ? cursor.value : lastValue;
      }
      lastValue = cursor.value;
    }

    return lastValue;
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
        const upper = url.slice(0, -1) + String.fromCharCode(url.charCodeAt(url.length - 1) + 1);
        return IDBKeyRange(url, upper, false, true);

      case "host":
        const origin = new URL(url).origin;
        return IDBKeyRange(origin + "/", origin + "0", false, true);

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


