"use strict";

import { openDB, deleteDB } from 'idb/with-async-ittr.js';
import { tsToDate, isNullBodyStatus, makeHeaders, digestMessage } from './utils';
import { fuzzyMatcher, fuzzyCompareUrls } from './fuzzymatcher';
import { getStatusText } from 'http-status-codes';
import { ArchiveResponse } from './response';
import { getTS } from './utils';


// ===========================================================================
class ArchiveDB {
  constructor(name, opts = {}) {
    this.name = name;
    this.db = null;

    const { minDedupSize } = opts;
    this.minDedupSize = Number.isInteger(minDedupSize) ? minDedupSize : 1024;

    this.version = 1;

    this.useRefCounts = true;

    this.allowRepeats = true;
    this.repeatTracker = this.allowRepeats ? new RepeatTracker() : null;
    this.fuzzyPrefixSearch = true;

    this.initing = this.init();
  }

  async init() {
    this.db = await openDB(this.name, this.version, {
      upgrade: (db, oldV, newV, tx) => this._initDB(db, oldV, newV, tx),
      blocking: (e) => { if (!e || e.newVersion === null) { this.close(); }}
    });
  }

  _initDB(db, oldV, newV, tx) {
    if (!oldV) {
      const pageStore = db.createObjectStore("pages", { keyPath: "id" });
      pageStore.createIndex("url", "url");
      pageStore.createIndex("ts", "ts");

      const listStore = db.createObjectStore("pageLists", { keyPath: "id", autoIncrement: true});

      const curatedPages = db.createObjectStore("curatedPages", { keyPath: "id", autoIncrement: true});
      curatedPages.createIndex("listPages", ["list", "pos"]);

      const urlStore = db.createObjectStore("resources", { keyPath: ["url", "ts"] });
      urlStore.createIndex("pageId", "pageId");
      //urlStore.createIndex("pageUrlTs", ["pageId", "url", "ts"]);
      //urlStore.createIndex("ts", "ts");
      urlStore.createIndex("mimeStatusUrl", ["mime", "status", "url"]);

      const payload = db.createObjectStore("payload", { keyPath: "digest", unique: true});
      const digestRef = db.createObjectStore("digestRef", { keyPath: "digest", unique: true});
    }

    //const fuzzyStore = db.createObjectStore("fuzzy", { keyPath: "key" });
  }

  async clearAll() {
    const stores = ["pages", "resources", "payload", "digestRef"];

    for (const store of stores) {
      await this.db.clear(store);
    }
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

  async addPage(page, tx) {
    const url = page.url;
    const title = page.title || page.url;
    const id = page.id || this.newPageId();
    let ts = page.ts;

    if (!ts && (page.date || page.datetime)) {
      ts = new Date(page.date || page.datetime).getTime();
    }

    const p = {...page, url, ts, title, id};
    if (tx) {
      tx.store.put(p);
      return p.id;
    } else {
      return await this.db.put("pages", p);
    }
  }

  async addPages(pages) {
    const tx = this.db.transaction("pages", "readwrite");

    for (const page of pages) {
      this.addPage(page);
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

  async addCuratedPageLists(pageLists, pageKey = "pages", filter = "public") {
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
        const type = typeof(data.page);
        // only store page id, if WR-style page object, reference the id
        if (type === "string") {
          pageData.page = data.page;
        } else if (type === "object") {
          pageData.page = data.page.id;
        } else {
          pageData.page = data.page_id || data.pageId;
        }
        pageData.desc = data.desc;

        tx.store.put(pageData);
      }

      try {
        await tx.done;
      } catch(e) {
        console.warn("addCuratedPageLists tx", e.toString());
      }
    }
  }

  async getAllCuratedByList() {
    const allLists = await this.db.getAll("pageLists");

    const tx = this.db.transaction("curatedPages", "readonly");

    for await (const cursor of tx.store.index("listPages").iterate()) {
      const list = allLists[cursor.value.list - 1];
      if (!list) {
        continue;
      }
      list.show = true;
      if (!list.pages) {
        list.pages = [];
      }
      list.pages.push(cursor.value);
    }

    return allLists;
  }

  

  //from http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
  newPageId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async getAllPages() {
    return await this.db.getAll("pages");
  }

  async getPages(pages) {
    const results = [];
    pages.sort();

    for await (const result of this.matchAny("pages", null, pages)) {
      results.push(result);
    }

    return results;
  }

  async dedupResource(digest, payload, tx) {
    const digestRefStore = tx.objectStore("digestRef");
    const ref = digest ? await digestRefStore.get(digest) : false;
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
        const size = payload.length;
        digestRefStore.put({digest, count, size});
      } catch (e) {
        console.log(e);
      }
    }

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

      if (this.useRefCounts && data.digest && data.payload) {
        await this.dedupResource(data.digest, data.payload, dtx);
        delete data.payload;
      }
    }

    try {
      await dtx.done;
    } catch(e) {
      console.log("Payload Bulk Add Failed: " + e);
    }

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
    let added = false;

    if (data.payload && data.payload.length > this.minDedupSize) {
      if (!data.digest) {
        data.digest = await digestMessage(payload, "sha-256");
      }
      const tx = this.db.transaction(["digestRef", "payload"], "readwrite");

      added = await this.dedupResource(data.digest, data.payload, tx);

      try {
        await tx.done;
      } catch(e) {
        console.log("Payload Add Failed: " + e);
      }

      delete data.payload;
    }

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

    const skip = this.repeatTracker ? this.repeatTracker.getSkipCount(event, url, request.request.method) : 0;
    const opts = {skip};

    if (url.startsWith("//")) {
      let useHttp = false;
      result = await this.lookupUrl("https:" + url, datetime, opts);
      if (!result) {
        result = await this.lookupUrl("http:" + url, datetime, opts);
        // use http if found or if referrer contains an http replay path
        // otherwise, default to https
        if (result || request.request.referrer.indexOf("/http://", 2) > 0) {
          useHttp = true;
        }
      }
      url = (useHttp ? "http:" : "https:") + url;
    } else {
      result = await this.lookupUrl(url, datetime, opts);
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

    if (!result && fuzzySearchData && this.fuzzyPrefixSearch) {
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
    const statusText = result.statusText || getStatusText(status);

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

  async lookupUrl(url, datetime, opts = {}) {
    const tx = this.db.transaction("resources", "readonly");

    if (datetime) {
      const res = await tx.store.get([url, datetime]);
      if (res) {
        return res;
      }
    }

    let lastValue = null;
    let skip = opts.skip || 0;

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

  async* resourcesByPages2(pageIds) {
    pageIds.sort();

    yield* this.matchAny("resources", "pageId", pageIds);
  }

  async* resourcesByPages(pageIds) {
    const tx = this.db.transaction("resources", "readonly");

    for await (const cursor of tx.store.iterate()) {
      if (pageIds.includes(cursor.value.pageId)) {
        yield cursor.value;
      }
    }
  }

  async* matchAny(storeName, indexName, sortedKeys, subKey) {
    const tx = this.db.transaction(storeName, "readonly");

    let cursor = indexName ? await tx.store.index(indexName).openCursor() : await tx.store.openCursor();

    let i = 0;

    while (cursor && i < sortedKeys.length) {
      let currKey, matchKey, matches;

      if (subKey !== undefined) {
        currKey = cursor.key[subKey];
        matchKey = sortedKeys[i][subKey];
        matches = currKey.startsWith(matchKey);
      } else {
        currKey = cursor.key;
        matchKey = sortedKeys[i];
        matches = currKey === matchKey;
      }

      if (!matches && currKey > matchKey) {
        ++i;
        continue;
      }

      if (matches) {
        yield cursor.value;
        cursor = await cursor.continue();
      } else {
        cursor = await cursor.continue(sortedKeys[i]);
      }
    }
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

    mimes.sort();

    let startKey = [];

    for (const mime of mimes) {
      if (fromMime && mime < fromMime) {
        continue;
      }
      if (fromMime && !startKey.length) {
        startKey.push([fromMime, 0, fromUrl]);
      }
      startKey.push([mime, 0, ""]);
    }

    for await (const result of this.matchAny("resources", "mimeStatusUrl", startKey, 0)) {
      results.push(this.resJson(result));
    }

    return results;
/*
    let i = 0;
    let cursor = await this.db.transaction("resources").store.index("mimeStatusUrl").openCursor();

    while (cursor && i < startKey.length) {
      const mime = cursor.key[0];

      const matches = mime.startsWith(startKey[i][0]);

      if (!matches && mime > startKey[i][0]) {
        ++i;
        continue;
      }

      if (matches) {
        results.push(this.resJson(cursor.value));
        cursor = await cursor.continue();
      } else {
        cursor = await cursor.continue(startKey[i]);
      }
    }
*/
  }

  async deletePage(id) {
    const tx = this.db.transaction("pages", "readwrite");
    const page = await tx.store.get(id);
    await tx.store.delete(id);

    const size = await this.deletePageResources(id);
    return {pageSize: page && page.size || 0,
            dedupSize: size};
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


