"use strict";

import { openDB, deleteDB } from 'idb/with-async-ittr.js';
import { tsToDate, isNullBodyStatus, makeHeaders, digestMessage } from './utils';
import { fuzzyMatcher, fuzzyCompareUrls } from './fuzzymatcher';
import { STATUS_CODES } from 'http';
import { ArchiveResponse } from './response';
import { getTS } from './utils';


// ===========================================================================
class ArchiveDB {
  constructor(name, opts = {}) {
    this.name = name;
    this.db = null;

    const { minDedupSize } = opts;
    this.minDedupSize = Number.isInteger(minDedupSize) ? minDedupSize : 1024;

    this.initing = this.init();
    this.version = 1;

    this.useRefCounts = true;

    this.allowRepeats = true;
    this.repeatTracker = this.allowRepeats ? new RepeatTracker() : null;
    this.fuzzyPrefixSearch = true;
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

    const listStore = db.createObjectStore("pageLists", { keyPath: "id", autoIncrement: true});

    const curatedPages = db.createObjectStore("curatedPages", { keyPath: "id", autoIncrement: true});
    curatedPages.createIndex("listPages", ["list", "pos"]);

    const urlStore = db.createObjectStore("resources", { keyPath: ["url", "ts"] });
    urlStore.createIndex("pageId", "pageId");
    //urlStore.createIndex("ts", "ts");
    urlStore.createIndex("mimeStatusUrl", ["mime", "status", "url"]);

    const payload = db.createObjectStore("payload", { keyPath: "digest", unique: true});
    const digestRef = db.createObjectStore("digestRef", { keyPath: "digest", unique: true});

    //const fuzzyStore = db.createObjectStore("fuzzy", { keyPath: "key" });
  }

  async clearAll() {
    const stores = ["pages", "resources", "payload", "digestRef"];
    const tx = this.db.transaction(stores, "readwrite");

    for (const store of stores) {
      this.db.clear(store);
    }

    await tx.done;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async delete() {
    this.close();
    await deleteDB(this.name, {
      blocked(reason) {
        console.log("Unable to delete: " + reason);
      }
    });
  }

  async addPage(data) {
    if (!data.id) {
      data.id = this.newPageId();
    }
    return await this.db.put("pages", data);
  }

  async addPages(pages) {
    const tx = this.db.transaction("pages", "readwrite");

    for (const page of pages) {
      const url = page.url;
      const title = page.title || page.url;
      const id = page.id || this.newPageId();
      let date = page.datetime;

      if (!date && page.timestamp) {
        date = tsToDate(page.timestamp).toISOString();
      }

      //console.log("id", id, date, title, url);

      tx.store.put({url, date, title, id});
    }

    try {
      await tx.done;
    } catch(e) {
      console.warn("addPages tx", e.toString());
    }
  }

  async addCPageList(data) {
    const listData = {};
    listData.title = data.title;
    listData.desc = data.desc;
    listData.slug = data.slug;

    return await this.db.put("pageLists", listData);
  }

  async addCuratedPageLists(pageLists, pageKey = "pages", filter) {
    for (const list of pageLists) {
      if (filter && !list[filter]) {
        continue;
      }

      const listId = await this.addCPageList(list);

      const tx = this.db.transaction("curatedPages", "readwrite");

      let pos = 0;

      const pages = list[pageKey] || [];

      for (const data of pages) {
        const pageData = {};
        pageData.pos = pos++;
        pageData.list  = listId;
        pageData.title = data.title;
        pageData.url = data.url;
        pageData.date = data.datetime || tsToDate(data.timestamp).toISOString();
        pageData.page = data.id;

        tx.store.put(pageData);
      }

      try {
        await tx.done;
      } catch(e) {
        console.warn("addCuratedPageLists tx", e.toString());
      }
    }
  }

  

  //from http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
  newPageId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async getAllPages() {
    return await this.db.getAllFromIndex("pages", "date");
  }

  async dedupResource(data, tx) {
    const ownTx = !tx;

    const payload = data.payload;
    const size = (payload ? payload.length : 0);

    let digest = data.digest;

    if (!digest && (!payload || size < this.minDedupSize)) {
      return false;
    }

    if (!digest) {
      digest = await digestMessage(payload, "sha-256");
    }

    if (!tx) {
      tx = this.db.transaction(["digestRef", "payload"], "readwrite");
    }

    const digestRefStore = tx.objectStore("digestRef");
    const ref = await digestRefStore.get(digest);
    let added = true;

    if (ref) {
      //console.log("Digest Dupe: " + digest + " for " + data.url);
      ++ref.count;
      digestRefStore.put(ref);
      added = false;
    } else {
      try {
        tx.objectStore("payload").add({digest, payload});
        const count = 1;
        digestRefStore.put({digest, count, size});
      } catch (e) {
        console.log(e);
      }
    }

    if (ownTx) {
      try {
        await tx.done;
      } catch(e) {
        console.log("Payload Add Failed: " + e);
      }
    }

    delete data.payload;
    data.digest = digest;

    return added;
  }

  async addResources(datas) {
    const revisits = [];
    const regulars = [];

    let dtx = this.db.transaction(["digestRef", "payload"], "readwrite");

    for (const data of datas) {
      if (data.mime === "warc/revisit") {
        revisits.push(data);
      } else {
        regulars.push(data);
      }

      if (this.useRefCounts) {
        await this.dedupResource(data, dtx);
      }
    }

    await dtx.done;

    const tx = this.db.transaction("resources", "readwrite");

    for (const data of revisits) {
      tx.store.put(data);
    }

    for (const data of regulars) {
      tx.store.put(data);

      this._addUrlFuzzy(data, tx);
    }

    await tx.done;
  }

  async _addUrlFuzzy(data, tx) {
    if (data.status >= 200 && data.status < 300 && data.status != 204) {
      for await (const fuzzyUrl of fuzzyMatcher.fuzzyUrls(data.url)) {
        if (fuzzyUrl === data.url) {
          continue;
        }

        //console.log(`Fuzzy ${fuzzyUrl} -> ${data.url}`);

        const fuzzyRes = {url: fuzzyUrl,
                          ts: data.ts,
                          origURL: data.url,
                          origTS: data.ts,
                          pageId: data.pageId,
                          digest: data.digest};
        tx.store.put(fuzzyRes);
      }
    }
  }

  async addResource(data) {
    let result = null;

    let added = await this.dedupResource(data);

    // only add revisit if not a dupe
    // don't allow revisits to override regular responses
    if (data.mime === "warc/revisit") {
      try {
        await this.db.add("resources", data);
      } catch (e) {
        console.log("Skip Duplicate revisit for: " + data.url);
      }

      return added;
    }

    const tx = this.db.transaction("resources", "readwrite");

    tx.store.put(data);

    this._addUrlFuzzy(data, tx);

    try {
      await tx.done;
    } catch (e) {
      console.log("Fuzzy Add Error for " + data.url);
      console.log(e);
    }

    return added;
  }

  async getResource(request, rwPrefix, event) {
    const datetime = tsToDate(request.timestamp).getTime();
    let url = request.url;

    let result = null;

    const skip = this.repeatTracker ? this.repeatTracker.getSkipCount(event, url, request.method) : 0;

    if (url.startsWith("//")) {
      const useHttp = false;
      result = await this.lookupUrl("https:" + url, datetime, skip);
      if (!result) {
        result = await this.lookupUrl("http:" + url, datetime, skip);
        // use http if found or if referrer contains an http replay path
        // otherwise, default to https
        if (result || request.request.referrer.indexOf("/http://", 2) > 0) {
          useHttp = true;
        }
      }
      url = (useHttp ? "http:" : "https:") + url;
    } else {
      result = await this.lookupUrl(url, datetime, skip);
    }

    let fuzzySearchData;

    if (!result) {
      for await (const [fuzzyUrl, fuzzyData] of fuzzyMatcher.fuzzyUrls(url, true)) {
        result = await this.lookupUrl(fuzzyUrl);
        if (result) {
          break;
        }
        fuzzySearchData = fuzzyData;
      }
    }

    if (!result && this.fuzzyPrefixSearch) {
      result = await this.lookupQueryPrefix(url, fuzzySearchData);
    }

    // check if redirect
    if (result && result.origURL) {
      const origResult = await this.lookupUrl(result.origURL, result.origTS || result.ts);
      if (origResult) {
        url = origResult.url;
        result = origResult;
      }
    }

    if (!result) {
      return null;
    }

    const status = result.status;
    const statusText = result.statusText || STATUS_CODES[status];

    const payload = !isNullBodyStatus(status) ? await this.loadPayload(result) : null;

    const headers = makeHeaders(result.respHeaders);

    const date = new Date(result.ts);

    const extraOpts = result.extraOpts || null;

    return new ArchiveResponse({url, payload, status, statusText, headers, date, extraOpts});
  }

  async loadPayload(result) {
    if (result.digest && !result.payload) {
      const payloadRes = await this.db.get("payload", result.digest);
      if (!payloadRes) {
        return null;
      }
      const { payload } = payloadRes;
      return payload;
    }

    return result.payload;
  }

  async lookupUrl(url, datetime, skip = 0) {
    const tx = this.db.transaction("resources", "readonly");

    if (skip > 0) {
      //console.log(`Skip ${skip} for ${url}`);
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
  async lookupQueryPrefix(url, fuzzySearchData) {
    const tx = this.db.transaction("resources", "readonly");

    let results = [];

    //const urlForFuzzy = url.split(splitKey, 1)[0] + splitKey;

    for await (const cursor of tx.store.iterate(this.getLookupRange(fuzzySearchData.prefix, "prefix"))) {
      results.push(cursor.value);
    }

    if (!results.length) {
      return null;
    }

    const result = fuzzyCompareUrls(url, results, fuzzySearchData);
    //if (result) {
      //console.log(`Fuzz: ${result.result.url} <-> ${url}`);
    //}
    return result.result;
  }

  resJson(res) {
    const date = new Date(res.ts).toISOString();
    return {
      url: res.url,
      date: date,
      ts: getTS(date),
      mime: res.mime,
      status: res.status
    }
  }

  async resourcesByPage(pageId) {
    return this.db.getAllFromIndex("resources", "pageId", pageId);
  }

  async resourcesByUrlAndMime(url, mimes, count = 1000, prefix = true, fromUrl = "", fromTs = "") {
    // if doing local mime filtering, need to remove count
    const queryCount = mimes ? null : count;

    const fullResults = await this.db.getAll("resources",
      this.getLookupRange(url, prefix ? "prefix" : "exact", fromUrl, fromTs), queryCount);

    mimes = mimes.split(",");
    const results = [];

    for (const res of fullResults) {
      for (const mime of mimes) {
        if (!mime || (res.mime && res.mime.startsWith(mime))) {
          results.push(this.resJson(res));
          if (results.length === count) {
            return results;
          }
          break;
        }
      }
    }

    return results;
  }

  async resourcesByMime(mimes, count = 100, fromMime = "", fromUrl = "") {
    mimes = mimes.split(",");
    const results = [];
    const lastChar = String.fromCharCode(0xFFFF);

    const mimeStart = lastChar;

    for (const mime of mimes) {
      const start = (fromMime ? [fromMime, 0, fromUrl] : [mime, 0, ""]);
      const mimeEnd = mime + lastChar;

      const range = IDBKeyRange.bound(start, [mimeEnd], true, true);

      const fullResults = await this.db.getAllFromIndex("resources", "mimeStatusUrl", range, count);
      
      for (const res of fullResults) {
        results.push(this.resJson(res));
      }
    }

    return results;
  }

  async deletePageResources(pageId) {
    const digestSet = {};

    const tx = this.db.transaction("resources", "readwrite");

    let cursor = await tx.store.index("pageId").openCursor(pageId);

    let size = 0;

    while (cursor) {
      const digest = cursor.value.digest;
      if (digest) {
        digestSet[digest] = (digestSet[digest] || 0) + 1;
      } else if (cursor.value.payload) {
        size += cursor.value.payload.length;
      }

      tx.store.delete(cursor.primaryKey);

      cursor = await cursor.continue();
    }

    await tx.done;

    // delete payloads
    const tx2 = this.db.transaction(["payload", "digestRef"], "readwrite");
    const digestRefStore = tx2.objectStore("digestRef");

    for (const digest of Object.keys(digestSet)) {
      const ref = await digestRefStore.get(digest);

      if (ref) {
        ref.count -= digestSet[digest];
      }

      if (ref && ref.count >= 1) {
        digestRefStore.put(ref);
      } else {
        size += ref ? ref.size : 0;
        digestRefStore.delete(digest);
        tx2.objectStore("payload").delete(digest);
      }
    }

    await tx2.done;
    return size;
  }

  getLookupRange(url, type, fromUrl, fromTs) {
    let lower;
    let upper;

    switch (type) {
      case "prefix":
        upper = url.slice(0, -1) + String.fromCharCode(url.charCodeAt(url.length - 1) + 1);
        lower = [url];
        upper = [upper];
        break;

      case "host":
        const origin = new URL(url).origin;
        lower = [origin + "/"];
        upper = [origin + "0"];
        break;

      case "exact":
      default:
        lower = [url];
        upper = [url + "!"];
    }

    let inclusive;

    if (fromUrl) {
      lower = [fromUrl, fromTs || ""];
      inclusive = true;
    } else {
      inclusive = false;
    }

    return IDBKeyRange.bound(lower, upper, inclusive, true);
  }
}

// ===========================================================================
class RepeatTracker {
  constructor() {
    this.repeats = {};
  }

  getSkipCount(event, url, method) {
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
}


export { ArchiveDB };


