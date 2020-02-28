"use strict";

import { openDB } from 'idb/with-async-ittr.js';
import { tsToSec, tsToDate, getTS, makeNewResponse, makeHeaders } from './utils';
import { fuzzyMatcher, fuzzyCompareUrls } from './fuzzymatcher';
import { STATUS_CODES } from 'http';


// ===========================================================================
class ArchiveDB {
  constructor(name) {
    this.name = name;
    this.db = null;
    this.initing = this.init();
    this.version = 1;

    this.repeats = {};
    this.allowRepeats = false;
    this.fuzzyPrefixSearch = false;
  }

  async init() {
    this.db = await openDB(this.name, this.version, {
      upgrade: (db, oldV, newV, tx) => this._initDB(db, oldV, newV, tx),
      blocking: (e) => { if (e.newVersion === null) { this.close(); }}
    });
  }

  _initDB(db, oldV, newV, tx) {
    const pageStore = db.createObjectStore("pages", { keyPath: "id" });
    pageStore.createIndex("url", "url");
    pageStore.createIndex("date", "date");

    const urlStore = db.createObjectStore("resources", { keyPath: ["url", "ts"] });
    urlStore.createIndex("pageId", "pageId");
    //urlStore.createIndex("ts", "ts");
    urlStore.createIndex("pageMime", ["page", "mime"]);

    const fuzzyStore = db.createObjectStore("fuzzy", { keyPath: "key" });
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }

  async addPage(data) {
    if (!data.id) {
      data.id = this.newPageId();
    }
    return await this.db.put("pages", data);
  }

  //from http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
  newPageId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async getAllPages() {
    return await this.db.getAllFromIndex("pages", "date");
  }

  async addResource(data, addFuzzy = true) {
    const result = await this.db.add("resources", data);

    if (addFuzzy && data.status >= 200 && data.status < 300 && data.status != 204) {
      for await (const fuzzyUrl of fuzzyMatcher.fuzzyUrls(data.url)) {
        if (fuzzyUrl === data.url) {
          continue;
        }

        try {
          await this.db.add("fuzzy", {
            key: fuzzyUrl,
            ts: data.ts,
            original: data.url,
            pageId: data.pageId
          });
        } catch (e) {
          console.warn(`Fuzzy Add Error: ${fuzzyUrl}`);
          console.warn(e);
        }
      }
    }

    return result;
  }

  _repeatCountFor(event, url, method) {
    if (!this.allowRepeats || method !== "POST") {
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

  async getResource(request, rwPrefix, event) {
    const datetime = tsToDate(request.timestamp).getTime();
    let url = request.url;

    let skip = this._repeatCountFor(event, url, request.method);

    let result = null;

    if (url.startsWith("//")) {
      result = await this.lookupUrl("https:" + url, datetime, skip);
      if (!result) {
        result = await this.lookupUrl("http:" + url, datetime, skip);
        url = "http:" + url;
      }
    } else {
      result = await this.lookupUrl(url, datetime, skip);
    }

    if (!result) {
      for await (const fuzzyUrl of fuzzyMatcher.fuzzyUrls(url)) {
        result = await this.lookupFuzzyUrl(fuzzyUrl);
        if (result) {
          result = await this.lookupUrl(result.original, datetime, skip);
        }
        if (result) {
          break;
        }
      }
    }

    if (!result && this.fuzzyPrefixSearch) {
      result = await this.lookupQueryPrefix(url);
    }

    if (!result) {
      return null;
    }

    const status = result.status;
    const statusText = result.statusText || STATUS_CODES[status];
    const headers = makeHeaders(result.respHeaders);

    const date = new Date(result.ts);

    return makeNewResponse(result.payload, {status, statusText, headers},
                           getTS(date.toISOString()), date);
  }

  async lookupFuzzyUrl(url) {
    return this.db.get("fuzzy", url);
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

  // experimental
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

    const result = fuzzyCompareUrls(url, results);
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
        let upper = url;
        upper = upper.slice(0, -1) + String.fromCharCode(url.charCodeAt(url.length - 1) + 1);
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


