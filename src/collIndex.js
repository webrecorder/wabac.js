"use strict";

import { openDB } from 'idb/with-async-ittr.js';
import { tsToSec, tsToDate, getTS, makeNewResponse, makeHeaders } from './utils';


class DBIndex {
  constructor(name) {
    this.name = name;
  }

  async init() {
    this.db = await openDB(this.name, 1, {
      upgrade(db, oldVersion, newVersion, transaction) {
        const pageStore = db.createObjectStore("pages", { keyPath: "id", autoIncrement: true });
        pageStore.createIndex("url", "url");

        const urlStore = db.createObjectStore("urls", { keyPath: ["url", "ts"] });
        urlStore.createIndex("session", "session");
        urlStore.createIndex("mime", "mime");
      }
    });
  }

  async addPage(data) {
    return await this.db.add("pages", data);   
  }

  async addUrl(data) {
    return await this.db.add("urls", data);
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
    const tx = this.db.transaction("urls", "readonly");

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

  async urlsBySession(session) {
    const tx = this.db.transaction("urls", "readonly");
    const urls = [];

    for await (const cursor of tx.store.index("session").iterate(session)) {
      urls.push(cursor.value);
    }

    return urls;
  }

  async deleteSession(session) {
    const tx = this.db.transaction("urls", "readwrite");

    let cursor = await tx.store.index("session").openKeyCursor(session);

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


export { DBIndex };


