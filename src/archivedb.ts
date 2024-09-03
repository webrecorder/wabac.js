import { openDB, deleteDB, IDBPDatabase } from "idb/with-async-ittr";
import {
  tsToDate,
  isNullBodyStatus,
  makeHeaders,
  digestMessage,
  getTS,
  getStatusText,
  randomId,
  PAGE_STATE_SYNCED,
} from "./utils";
import { fuzzyMatcher } from "./fuzzymatcher";
import { ArchiveResponse } from "./response";
import {
  DBStore,
  DigestRefCount,
  PageEntry,
  ResAPIResponse,
  ResourceEntry,
} from "./types";
import { ArchiveRequest } from "./request";

const MAX_FUZZY_MATCH = 128000;
const MAX_RESULTS = 16;
const MAX_DATE_TS = new Date("9999-01-01").getTime();

const REVISIT = "warc/revisit";

const EMPTY_PAYLOAD_SHA256 =
  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// sha-1 digests often base32 encoded
const EMPTY_PAYLOAD_SHA1 = "sha1:3I42H3S6NNFQ2MSVX7XZKYAYSCX5QBYJ";

const DB_VERSION = 4;

// ===========================================================================
export class ArchiveDB implements DBStore {
  name: string;
  minDedupSize: number;
  version: number;
  autoHttpsCheck = true;
  useRefCounts = false;
  allowRepeats = true;
  repeatTracker: RepeatTracker | null = null;
  fuzzyPrefixSearch = true;
  initing: Promise<void>;
  db: IDBPDatabase | null = null;

  constructor(name: string, opts: any = {}) {
    this.name = name;
    this.db = null;

    const { minDedupSize, noRefCounts } = opts;
    this.minDedupSize = Number.isInteger(minDedupSize) ? minDedupSize : 1024;

    this.version = DB_VERSION;

    this.autoHttpsCheck = true;
    this.useRefCounts = !noRefCounts;

    this.allowRepeats = true;
    this.repeatTracker = this.allowRepeats ? new RepeatTracker() : null;
    this.fuzzyPrefixSearch = true;

    this.initing = this.init();
  }

  async init() {
    let oldVersion = 0;

    this.db = await openDB(this.name, this.version, {
      upgrade: (db, oldV, newV, tx) => {
        oldVersion = oldV;
        this._initDB(db, oldV, newV, tx);
      },
      blocking: (_, oldV) => {
        if (!oldV) {
          this.close();
        }
      },
    });

    if (oldVersion === 1) {
      await this.convertCuratedPagesToV2(this.db);
    }
  }

  _initDB(db: any, oldV: number, newV: number | null, tx: any) {
    if (!oldV) {
      const pageStore = db.createObjectStore("pages", { keyPath: "id" });
      pageStore.createIndex("url", "url");
      pageStore.createIndex("ts", "ts");
      pageStore.createIndex("state", "state");

      db.createObjectStore("pageLists", { keyPath: "id", autoIncrement: true });

      const curatedPages = db.createObjectStore("curatedPages", {
        keyPath: "id",
        autoIncrement: true,
      });
      curatedPages.createIndex("listPages", ["list", "pos"]);

      const urlStore = db.createObjectStore("resources", {
        keyPath: ["url", "ts"],
      });
      urlStore.createIndex("pageId", "pageId");
      //urlStore.createIndex("pageUrlTs", ["pageId", "url", "ts"]);
      //urlStore.createIndex("ts", "ts");
      urlStore.createIndex("mimeStatusUrl", ["mime", "status", "url"]);

      db.createObjectStore("payload", { keyPath: "digest", unique: true });
      db.createObjectStore("digestRef", { keyPath: "digest", unique: true });
    }
  }

  async clearAll() {
    const stores = ["pages", "resources", "payload", "digestRef"];

    if (!this.db) {
      return;
    }

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
      blocked(_, e) {
        console.log("Unable to delete: " + e);
      },
    });
  }

  async addPage(page: PageEntry, tx: any) {
    const url = page.url;
    const title = page.title || page.url;
    const id = page.id || this.newPageId();
    const state = page.state || PAGE_STATE_SYNCED;
    let ts = page.ts;

    if (typeof ts !== "number") {
      if (page.timestamp) {
        ts = tsToDate(page.timestamp).getTime();
      } else {
        const date = page.ts || page.date || page.datetime;
        if (date) {
          ts = new Date(date).getTime();
        }
      }
    }

    const p = { ...page, url, ts, title, id, state };

    if (tx) {
      tx.store.put(p);
      return p.id;
    } else {
      return await this.db!.put("pages", p);
    }
  }

  async addPages(pages: PageEntry[], pagesTable = "pages", update = false) {
    const tx = this.db!.transaction(pagesTable, "readwrite");

    for (const page of pages) {
      if (update) {
        tx.store.put(page);
      } else {
        this.addPage(page, tx);
      }
    }

    try {
      await tx.done;
    } catch (e: any) {
      console.warn("addPages tx", e.toString());
    }
  }

  async createPageList(data: Record<string, any>) {
    const listData: any = {};
    listData.title = data.title;
    listData.desc = data.desc || data.description;
    listData.slug = data.id || data.slug;

    return await this.db!.put("pageLists", listData);
  }

  async addCuratedPageList(listInfo: Record<string, any>, pages: PageEntry[]) {
    const listId = await this.createPageList(listInfo);

    let pos = 0;

    for (const page of pages) {
      page.pos = pos++;
      page.list = listId;
    }

    await this.addPages(pages, "curatedPages");
  }

  async addCuratedPageLists(
    pageLists: any[],
    pageKey = "pages",
    filter = "public",
  ) {
    for (const list of pageLists) {
      if (filter && !list[filter]) {
        continue;
      }

      const pages = list[pageKey] || [];

      await this.addCuratedPageList(list, pages);
    }
  }

  async convertCuratedPagesToV2(db: any) {
    const curatedPages = await db.getAll("curatedPages");

    if (!curatedPages || !curatedPages.length) {
      return;
    }

    const pages = await db.getAll("pages");
    const pageMap = new Map();

    for (const page of pages) {
      pageMap.set(page.id, page);
    }

    for (const cpage of curatedPages) {
      if (cpage.page) {
        const page = pageMap.get(cpage.page);
        if (page) {
          cpage.id = this.newPageId();
          cpage.url = page.url;
          cpage.ts = page.ts;
          if (!cpage.title && page.title) {
            cpage.title = page.title;
          }
        }
        delete cpage.page;
      }
    }

    await db.clear("curatedPages");

    const tx = db.transaction("curatedPages", "readwrite");

    for (const cpage of curatedPages) {
      tx.store.put(cpage);
    }

    try {
      await tx.done;
    } catch (e) {
      console.warn("Conversion Failed", e);
    }
  }

  async getCuratedPagesByList() {
    const allLists = await this.db!.getAll("pageLists");

    const tx = this.db!.transaction("curatedPages", "readonly");

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

  newPageId() {
    return randomId();
  }

  async getAllPages() {
    return await this.db!.getAll("pages");
  }

  async getPages(pages: PageEntry[]) {
    const results: string[] = [];
    pages.sort();

    for await (const result of this.matchAny("pages", null, pages)) {
      results.push(result);
    }

    return results;
  }

  async getTimestampsByURL(url: string) {
    const tx = this.db!.transaction("resources");
    const range = IDBKeyRange.bound([url], [url, MAX_DATE_TS]);
    const results: string[] = [];
    for await (const cursor of tx.store.iterate(range)) {
      results.push((cursor.key as string[])[1]);
    }
    return results;
  }

  async getPagesWithState(state: number) {
    return await this.db!.getAllFromIndex("pages", "state", state);
  }

  async getVerifyInfo() {
    return {};
  }

  async addVerifyData(
    prefix = "",
    id: string,
    expected: string,
    actual: string | null = null,
    log = false,
  ) {
    return;
  }

  async addVerifyDataList(prefix: string, datalist: any[]) {
    return;
  }

  async dedupResource(
    digest: string,
    payload: Uint8Array | null | undefined,
    tx: any,
    count = 1,
  ): Promise<DigestRefCount | null> {
    const digestRefStore = tx.objectStore("digestRef");
    const ref = await digestRefStore.get(digest);

    if (ref) {
      ++ref.count;
      return ref;
      //digestRefStore.put(ref);
      //return ref.count;
    } else if (payload) {
      try {
        tx.objectStore("payload").put({ digest, payload });
        const size = payload.length;
        //digestRefStore.put({digest, count, size});
        return { digest, count, size };
      } catch (e) {
        console.log(e);
      }
    }

    return null;
  }

  async addResources(datas: ResourceEntry[]) {
    const revisits: ResourceEntry[] = [];
    const redirectsAndErrors: ResourceEntry[] = [];
    const regulars: ResourceEntry[] = [];

    const digestRefCount: Record<string, DigestRefCount | null> = {};
    const changedDigests = new Set<string>();

    const dtx = this.db!.transaction(["digestRef", "payload"], "readwrite");

    for (const data of datas) {
      let refCount = 1;

      const status = data.status || 200;

      const array =
        data.mime === REVISIT
          ? revisits
          : status >= 300
            ? redirectsAndErrors
            : regulars;

      array.push(data);

      const fuzzyUrlData = this.getFuzzyUrl(data);

      if (fuzzyUrlData) {
        array.push(fuzzyUrlData);
        refCount = 2;
      }

      if (this.useRefCounts && data.digest) {
        const currDigest = digestRefCount[data.digest];
        if (!currDigest) {
          digestRefCount[data.digest] = await this.dedupResource(
            data.digest,
            data.payload,
            dtx,
            refCount,
          );
        } else {
          currDigest.count += refCount;
          changedDigests.add(data.digest);
        }
        delete data.payload;
      }
    }

    if (this.useRefCounts) {
      const digestRefStore = dtx.objectStore("digestRef");

      for (const digest of changedDigests) {
        digestRefStore.put(digestRefCount[digest]);
      }
    }

    try {
      await dtx.done;
    } catch (e) {
      console.error("Payload and Ref Count Bulk Add Failed: ", e);
    }

    // Add resources
    const tx = this.db!.transaction("resources", "readwrite");

    // First, add revisits
    for (const data of revisits) {
      tx.store.put(data);
    }

    // Then, add non-revisit errors and redirects, overriding any revisits
    for (const data of redirectsAndErrors) {
      tx.store.put(data);
    }

    // Then, add non-revisits success entries, overriding any previous entries
    for (const data of regulars) {
      tx.store.put(data);
    }

    try {
      await tx.done;
    } catch (e) {
      console.error("Resources Bulk Add Failed", e);
    }
  }

  getFuzzyUrl(result: ResourceEntry): ResourceEntry | null {
    if (
      result.status &&
      result.status >= 200 &&
      result.status < 400 &&
      result.status !== 304 &&
      result.status !== 204
    ) {
      const { fuzzyCanonUrl } = fuzzyMatcher.getRuleFor(result.url);

      if (!fuzzyCanonUrl || fuzzyCanonUrl === result.url) {
        return null;
      }

      const fuzzyRes = {
        url: fuzzyCanonUrl,
        ts: result.ts,
        origURL: result.url,
        origTS: result.ts,
        pageId: result.pageId,
        digest: result.digest,
      };

      return fuzzyRes;
    }

    return null;
  }

  async addResource(data: ResourceEntry): Promise<boolean> {
    if (data.payload && data.payload.length > this.minDedupSize) {
      if (!data.digest) {
        data.digest = await digestMessage(data.payload, "sha-256");
      }
    }

    let digestRefCount: DigestRefCount | null = null;
    let isNew = false;

    const tx = this.db!.transaction(
      ["resources", "digestRef", "payload"],
      "readwrite",
    );

    if (data.payload && data.payload.length > this.minDedupSize) {
      digestRefCount = await this.dedupResource(
        data.digest || "",
        data.payload,
        tx,
      );
      isNew = !!digestRefCount && digestRefCount.count === 1;
      delete data.payload;
    } else if (data.payload) {
      isNew = true;
    }

    if (data.mime !== REVISIT) {
      tx.objectStore("resources").put(data);

      const fuzzyUrlData = this.getFuzzyUrl(data);

      if (fuzzyUrlData) {
        tx.objectStore("resources").put(fuzzyUrlData);
        if (digestRefCount) {
          digestRefCount.count++;
        }
      }
    } else {
      // using add() to allow failing if non-revisit already exists
      tx.objectStore("resources").add(data);
    }

    if (digestRefCount) {
      tx.objectStore("digestRef").put(digestRefCount);
    }

    try {
      await tx.done;
    } catch (e) {
      if (data.mime === REVISIT) {
        console.log("Skip Duplicate revisit for: " + data.url);
      } else {
        console.log("Add Error for " + data.url);
      }
      console.log(e);
    }

    return isNew;
  }

  async getResource(
    request: ArchiveRequest,
    prefix: string,
    event: FetchEvent,
    opts: Record<string, any> = {},
  ): Promise<ArchiveResponse | Response | null> {
    const ts = tsToDate(request.timestamp).getTime();
    let url: string = request.url;

    let result: ResourceEntry | null = null;

    const skip = this.repeatTracker
      ? this.repeatTracker.getSkipCount(event, url, request.request.method)
      : 0;
    const newOpts = { ...opts, skip };

    if (url.startsWith("//")) {
      let useHttp = false;
      result = await this.lookupUrl("https:" + url, ts, newOpts);
      if (!result) {
        result = await this.lookupUrl("http:" + url, ts, newOpts);
        // use http if found or if referrer contains an http replay path
        // otherwise, default to https
        if (result || request.request.referrer.indexOf("/http://", 2) > 0) {
          useHttp = true;
        }
      }
      url = (useHttp ? "http:" : "https:") + url;
    } else {
      result = await this.lookupUrl(url, ts, newOpts);
      if (!result && this.autoHttpsCheck && url.startsWith("http://")) {
        const httpsUrl = url.replace("http://", "https://");
        result = await this.lookupUrl(httpsUrl, ts, newOpts);
        if (result) {
          url = httpsUrl;
        }
      }
    }

    if (!result && this.fuzzyPrefixSearch && !opts.noFuzzyCheck) {
      result = await this.lookupQueryPrefix(url, opts);
    }

    // check if redirect
    if (result && result.origURL) {
      const origResult = await this.lookupUrl(
        result.origURL,
        result.origTS || result.ts,
        opts,
      );
      if (origResult) {
        url = origResult.url;
        result = origResult;
      }
    }

    if (!result) {
      return null;
    }

    const status = result.status || 0;
    const statusText: string = result.statusText || getStatusText(status);

    let payload = null;

    if (!isNullBodyStatus(status)) {
      payload = await this.loadPayload(result, opts);
      if (!payload) {
        return null;
      }
    }

    const headers = result.respHeaders
      ? makeHeaders(result.respHeaders)
      : new Headers();

    const date = new Date(result.ts);

    const extraOpts = result.extraOpts || null;

    url = result.url;

    if (url !== request.url) {
      headers.set("Content-Location", url);
    }

    return new ArchiveResponse({
      url,
      payload,
      status,
      statusText,
      headers,
      date,
      extraOpts,
    });
  }

  async loadPayload(result: Record<string, any>, opts: Record<string, any>) {
    if (result.digest && !result.payload) {
      if (
        result.digest === EMPTY_PAYLOAD_SHA256 ||
        result.digest === EMPTY_PAYLOAD_SHA1
      ) {
        return new Uint8Array([]);
      }
      const payloadRes = await this.db!.get("payload", result.digest);
      if (!payloadRes) {
        return null;
      }
      const { payload } = payloadRes;
      return payload;
    }

    return result.payload;
  }

  isSelfRedirect(url: string, result: ResourceEntry) {
    try {
      if (
        result &&
        result.respHeaders &&
        result.status &&
        result.status >= 300 &&
        result.status < 400
      ) {
        const location = new Headers(result.respHeaders).get("location");
        if (new URL(self.location.href, url).href === url) {
          return true;
        }
      }
    } catch (e) {
      // just in case, ignore errors here, assume not self-redirect
    }

    return false;
  }

  async lookupUrl(
    url: string,
    ts?: number,
    opts: Record<string, any> = {},
  ): Promise<ResourceEntry | null> {
    const tx = this.db!.transaction("resources", "readonly");

    if (ts) {
      const range = IDBKeyRange.bound([url, ts], [url, MAX_DATE_TS]);

      if (!opts.noRevisits && !opts.pageId) {
        const result = await tx.store.get(range);

        if (result && this.isSelfRedirect(url, result)) {
          // assume the self-redirect URL is later then current URL
          // allowing looking up ts + 10 seconds to match redirected to URL
          ts += 1000 * 10;
        } else if (result) {
          return result;
        }
      } else {
        let results = await tx.store.getAll(range, MAX_RESULTS);
        results = results || [];

        for (const result of results) {
          if (opts.pageId && result.pageId && result.pageId !== opts.pageId) {
            continue;
          }

          if (opts.noRevisits && result.mime === REVISIT) {
            continue;
          }

          if (this.isSelfRedirect(url, result)) {
            continue;
          }

          return result;
        }
      }
    }

    // search reverse from ts (or from latest capture)
    const range = IDBKeyRange.bound([url], [url, ts || MAX_DATE_TS]);

    for await (const cursor of tx.store.iterate(range, "prev")) {
      const result = cursor.value;

      if (opts.pageId && result.pageId && result.pageId !== opts.pageId) {
        continue;
      }

      if (opts.noRevisits && result.mime === REVISIT) {
        continue;
      }

      if (this.isSelfRedirect(url, result)) {
        continue;
      }

      return result;
    }

    return null;
  }

  async lookupQueryPrefix(
    url: string,
    opts: Record<string, any>,
  ): Promise<ResourceEntry | null> {
    const { rule, prefix, fuzzyCanonUrl /*, fuzzyPrefix*/ } =
      fuzzyMatcher.getRuleFor(url);

    if (fuzzyCanonUrl !== url) {
      const result = await this.lookupUrl(fuzzyCanonUrl, 0, opts);
      if (result) {
        return result;
      }

      //const results = await this.db.getAll("resources", this.getLookupRange(fuzzyPrefix, "prefix"));
      //return fuzzyMatcher.fuzzyCompareUrls(url, results, rule);
    }

    // only do fuzzy prefix match for custom rules that have a query
    if (
      !rule &&
      prefix === url &&
      prefix === fuzzyCanonUrl &&
      !url.endsWith("?")
    ) {
      return null;
    }

    //todo: explore optimizing with incremental loading?
    const results = await this.db!.getAll(
      "resources",
      this.getLookupRange(prefix, "prefix"),
      MAX_FUZZY_MATCH,
    );

    return fuzzyMatcher.fuzzyCompareUrls(url, results, rule) as ResourceEntry;
  }

  resJson(res: ResourceEntry): ResAPIResponse {
    const date = new Date(res.ts).toISOString();
    return {
      url: res.url,
      date: date,
      ts: getTS(date),
      mime: res.mime || "",
      status: res.status || 0,
    };
  }

  async resourcesByPage(pageId: string) {
    return this.db!.getAllFromIndex("resources", "pageId", pageId);
  }

  async *resourcesByPages2(pageIds: string[]) {
    pageIds.sort();

    yield* this.matchAny("resources", "pageId", pageIds);
  }

  async *resourcesByPages(pageIds: string[]) {
    const tx = this.db!.transaction("resources", "readonly");

    for await (const cursor of tx.store.iterate()) {
      if (pageIds.includes(cursor.value.pageId)) {
        yield cursor.value;
      }
    }
  }

  async *matchAny(
    storeName: string,
    indexName: string | null,
    sortedKeys: any[],
    subKey?: number,
    openBound = false,
  ): AsyncGenerator<any> {
    const tx = this.db!.transaction(storeName, "readonly");

    const range = IDBKeyRange.lowerBound(sortedKeys[0], openBound);

    let cursor = indexName
      ? await tx.store.index(indexName).openCursor(range)
      : await tx.store.openCursor(range);

    let i = 0;

    while (cursor && i < sortedKeys.length) {
      let currKey, matchKey, matches;

      if (subKey !== undefined) {
        currKey = (cursor.key as string[])[subKey];
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

  async resourcesByUrlAndMime(
    url: string,
    mimes: string,
    count = 1000,
    prefix = true,
    fromUrl = "",
    fromTs = "",
  ): Promise<ResAPIResponse[]> {
    // if doing local mime filtering, need to remove count
    const queryCount = mimes ? 0 : count;

    const fullResults: ResourceEntry[] = await this.db!.getAll(
      "resources",
      this.getLookupRange(url, prefix ? "prefix" : "exact", fromUrl, fromTs),
      queryCount,
    );

    const mimesArray = mimes.split(",");
    const results: ResAPIResponse[] = [];

    for (const res of fullResults) {
      for (const mime of mimesArray) {
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

  async resourcesByMime(
    mimesStr: string,
    count = 100,
    fromMime = "",
    fromUrl = "",
    fromStatus = 0,
  ): Promise<ResAPIResponse[]> {
    const mimes = mimesStr.split(",");
    const results: ResAPIResponse[] = [];

    mimes.sort();

    let startKey: [string, number, string][] = [];

    if (fromMime) {
      startKey.push([fromMime, fromStatus, fromUrl]);
    }

    for (const mime of mimes) {
      if (!fromMime || !mime || mime > fromMime) {
        startKey.push([mime, 0, ""]);
      }
    }

    for await (const result of this.matchAny(
      "resources",
      "mimeStatusUrl",
      startKey,
      0,
      true,
    )) {
      results.push(this.resJson(result));

      if (results.length === count) {
        break;
      }
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

  async deletePage(
    id: string,
  ): Promise<{ pageSize: number; dedupSize: number }> {
    const tx = this.db!.transaction("pages", "readwrite");
    const page = await tx.store.get(id);
    await tx.store.delete(id);

    const size = await this.deletePageResources(id);
    return { pageSize: page?.size || 0, dedupSize: size };
  }

  async deletePageResources(pageId: string): Promise<number> {
    const digestSet: Record<string, number> = {};

    const tx = this.db!.transaction("resources", "readwrite");

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
    const tx2 = this.db!.transaction(["payload", "digestRef"], "readwrite");
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

  prefixUpperBound(url: string) {
    return (
      url.slice(0, -1) + String.fromCharCode(url.charCodeAt(url.length - 1) + 1)
    );
  }

  getLookupRange(
    url: string,
    type: string,
    fromUrl?: string,
    fromTs?: string,
  ): IDBKeyRange {
    let lower;
    let upper;

    switch (type) {
      case "prefix":
        lower = [url];
        upper = [this.prefixUpperBound(url)];
        break;

      case "host": {
        const origin = new URL(url).origin;
        lower = [origin + "/"];
        upper = [origin + "0"];
        break;
      }

      case "exact":
      default:
        lower = [url];
        //upper = [url + "!"];
        upper = [url, Number.MAX_SAFE_INTEGER];
    }

    let exclusive;

    if (fromUrl) {
      lower = [fromUrl, fromTs || ""];
      exclusive = true;
    } else {
      exclusive = false;
    }

    return IDBKeyRange.bound(lower, upper, exclusive, true);
  }
}

// ===========================================================================
class RepeatTracker {
  repeats: Record<string, Record<string, number>> = {};

  getSkipCount(event: any, url: string, method: string) {
    if (method !== "POST" && !url.endsWith(".m3u8")) {
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
