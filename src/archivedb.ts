import {
  openDB,
  deleteDB,
  type IDBPDatabase,
  type IDBPTransaction,
} from "idb/with-async-ittr";
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
  type DBStore,
  type DigestRefCount,
  type PageEntry,
  type ResAPIResponse,
  type ResourceEntry,
} from "./types";
import { type ArchiveRequest } from "./request";
import { type BaseAsyncIterReader } from "warcio";

const MAX_FUZZY_MATCH = 128000;
const MAX_RESULTS = 16;
const MAX_DATE_TS = new Date("9999-01-01").getTime();

const REVISIT = "warc/revisit";

const EMPTY_PAYLOAD_SHA256 =
  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// sha-1 digests often base32 encoded
const EMPTY_PAYLOAD_SHA1 = "sha1:3I42H3S6NNFQ2MSVX7XZKYAYSCX5QBYJ";

const DB_VERSION = 4;

export type ADBOpts = {
  minDedupSize?: number | undefined;
  noRefCounts?: unknown;
  noFuzzyCheck?: boolean;
  noRevisits?: boolean;
  pageId?: string;
};

export type ADBType = {
  pages: {
    key: string;
    value: PageEntry & { size?: number };
    indexes: { url: string; ts: string; state: number };
  };
  pageLists: {
    key: string;
    value: {
      pages?: unknown[];
      show?: boolean;
      title?: string | undefined;
      desc?: string | undefined;
      slug?: string | undefined;
    };
  };
  curatedPages: {
    key: string;
    value: PageEntry;
    indexes: { listPages: [string, string] };
  };
  resources: {
    key: [string, string];
    value: ResourceEntry;
    indexes: { pageId: string; mimeStatusUrl: [string, string, string] };
  };
  payload: {
    key: string;
    value: { digest: string; payload: Uint8Array | null };
    indexes: { digest: string };
  };
  digestRef: {
    key: string;
    value: DigestRefCount | null;
    indexes: { digest: string };
  };
};
// ===========================================================================
// TODO @emma-sg make this generic so that it can be extended with other DB schemas
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
  db: IDBPDatabase<ADBType> | null = null;

  constructor(name: string, opts: ADBOpts | undefined = {}) {
    this.name = name;
    this.db = null;

    const { minDedupSize, noRefCounts } = opts;
    this.minDedupSize = Number.isInteger(minDedupSize) ? minDedupSize! : 1024;

    this.version = DB_VERSION;

    this.autoHttpsCheck = true;
    this.useRefCounts = !noRefCounts;

    this.allowRepeats = true;
    this.repeatTracker = new RepeatTracker();
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

  _initDB(
    db: IDBPDatabase<ADBType>,
    oldV: number,
    _newV: number | null,
    _tx?: IDBPTransaction<
      ADBType,
      (keyof ADBType)[],
      "readwrite" | "versionchange"
    >,
  ) {
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

      const payloadStore = db.createObjectStore("payload", {
        keyPath: "digest",
      });
      payloadStore.createIndex("digest", "digest", { unique: true });

      const digestRef = db.createObjectStore("digestRef", {
        keyPath: "digest",
      });
      digestRef.createIndex("digest", "digest", { unique: true });
    }
  }

  async clearAll() {
    const stores = ["pages", "resources", "payload", "digestRef"] as const;

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
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        console.log("Unable to delete: " + e);
      },
    });
  }

  async addPage(
    page: PageEntry,
    tx?: IDBPTransaction<ADBType, [keyof ADBType], "readwrite"> | null,
  ) {
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
      void tx.store.put(p);
      return p.id;
    } else {
      return await this.db!.put("pages", p);
    }
  }

  async addPages(
    pages: PageEntry[],
    pagesTable: keyof ADBType = "pages",
    update = false,
  ) {
    const tx = this.db!.transaction(pagesTable, "readwrite");

    for (const page of pages) {
      if (update) {
        void tx.store.put(page);
      } else {
        void this.addPage(page, tx);
      }
    }

    try {
      await tx.done;
    } catch (e) {
      console.warn("addPages tx", String(e));
    }
  }

  async createPageList(data: {
    title?: string;
    desc?: string;
    description?: string;
    id?: string;
    slug?: string;
  }) {
    const listData = {
      title: data.title,
      desc: data.desc || data.description,
      slug: data.id || data.slug,
    };
    return await this.db!.put("pageLists", listData);
  }

  async addCuratedPageList(
    listInfo: Record<string, unknown>,
    pages: PageEntry[],
  ) {
    const listId = await this.createPageList(listInfo);

    let pos = 0;

    for (const page of pages) {
      page.pos = pos++;
      page.list = listId;
    }

    await this.addPages(pages, "curatedPages");
  }

  async addCuratedPageLists(
    pageLists: { [k: string]: PageEntry[] | undefined }[],
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

  async convertCuratedPagesToV2(
    db: IDBPDatabase<
      ADBType & {
        pages: { key: string; value: { page?: PageEntry } & PageEntry };
        curatedPages: { key: string; value: { page?: PageEntry } & PageEntry };
      }
    >,
  ) {
    const curatedPages = (await db.getAll("curatedPages")) as
      | (PageEntry & {
          page?: PageEntry;
        })[]
      | null;

    if (!curatedPages?.length) {
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
      void tx.store.put(cpage);
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
      const list = allLists[cursor.value.list - 1] as
        | (typeof allLists)[number]
        | undefined;
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

  async getPages(pages: string[]) {
    const results: PageEntry[] = [];
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
      results.push((cursor.key as string[])[1]!);
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
    _prefix = "",
    _id: string,
    _expected: string,
    _actual: string | null = null,
    _log = false,
  ) {
    return;
  }

  async addVerifyDataList(_prefix: string, _datalist: unknown[]) {
    return;
  }

  async dedupResource(
    digest: string,
    payload: Uint8Array | null | undefined,
    tx: IDBPTransaction<ADBType, (keyof ADBType)[], "readwrite">,
    count = 1,
  ): Promise<DigestRefCount | null> {
    const digestRefStore = tx.objectStore("digestRef");
    const ref = await digestRefStore.get(digest);

    if (ref) {
      ++ref.count!;
      return ref;
      //digestRefStore.put(ref);
      //return ref.count;
    } else if (payload) {
      try {
        void tx.objectStore("payload").put({ digest, payload });
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
          currDigest.count! += refCount;
          changedDigests.add(data.digest);
        }
        delete data.payload;
      }
    }

    if (this.useRefCounts) {
      const digestRefStore = dtx.objectStore("digestRef");

      for (const digest of changedDigests) {
        void digestRefStore.put(digestRefCount[digest]!);
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
      void tx.store.put(data);
    }

    // Then, add non-revisit errors and redirects, overriding any revisits
    for (const data of redirectsAndErrors) {
      void tx.store.put(data);
    }

    // Then, add non-revisits success entries, overriding any previous entries
    for (const data of regulars) {
      void tx.store.put(data);
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
      void tx.objectStore("resources").put(data);

      const fuzzyUrlData = this.getFuzzyUrl(data);

      if (fuzzyUrlData) {
        void tx.objectStore("resources").put(fuzzyUrlData);
        if (digestRefCount) {
          digestRefCount.count!++;
        }
      }
    } else {
      // using add() to allow failing if non-revisit already exists
      void tx.objectStore("resources").add(data);
    }

    if (digestRefCount) {
      void tx.objectStore("digestRef").put(digestRefCount);
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
    _prefix: string,
    event: FetchEvent,
    opts: ADBOpts = {},
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
    if (result?.origURL) {
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
      payload: payload as Uint8Array | null,
      status,
      statusText,
      headers,
      date,
      extraOpts,
    });
  }

  async loadPayload(
    result: ResourceEntry,
    _opts: ADBOpts,
  ): Promise<BaseAsyncIterReader | Uint8Array | null> {
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

    return result.payload || null;
  }

  isSelfRedirect(url: string, result: ResourceEntry | undefined) {
    try {
      if (
        result?.respHeaders &&
        result.status &&
        result.status >= 300 &&
        result.status < 400
      ) {
        const location = new Headers(result.respHeaders).get("location") || "";
        if (new URL(location, url).href === url) {
          return true;
        }
      }
    } catch (_e) {
      // just in case, ignore errors here, assume not self-redirect
    }

    return false;
  }

  async lookupUrl(
    url: string,
    ts?: number,
    opts: ADBOpts = {},
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
        let results = (await tx.store.getAll(range, MAX_RESULTS)) as
          | ResourceEntry[]
          | undefined;
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
    opts: ADBOpts,
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
      if (pageIds.includes(cursor.value.pageId!)) {
        yield cursor.value;
      }
    }
  }

  async *matchAny<S extends keyof ADBType>(
    storeName: S,
    indexName: ADBType[S] extends { indexes: {} }
      ? keyof ADBType[S]["indexes"] | null
      : null,
    sortedKeys: string[],
    subKey?: number,
    openBound = false,
  ) {
    const tx = this.db!.transaction(storeName, "readonly");

    const range = IDBKeyRange.lowerBound(sortedKeys[0], openBound);

    let cursor = indexName
      ? await tx.store.index(indexName).openCursor(range)
      : await tx.store.openCursor(range);

    let i = 0;

    while (cursor && i < sortedKeys.length) {
      let currKey, matchKey, matches;

      if (subKey !== undefined) {
        currKey = (cursor.key as string[])[subKey]!;
        matchKey = sortedKeys[i]![subKey]!;
        matches = currKey.startsWith(matchKey);
      } else {
        currKey = cursor.key;
        matchKey = sortedKeys[i]!;
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
        // TODO @emma-sg figure this out later
        // @ts-expect-error
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

    const fullResults = await this.db!.getAll(
      "resources",
      this.getLookupRange(url, prefix ? "prefix" : "exact", fromUrl, fromTs),
      queryCount,
    );

    const mimesArray = mimes.split(",");
    const results: ResAPIResponse[] = [];

    for (const res of fullResults) {
      for (const mime of mimesArray) {
        if (!mime || res.mime?.startsWith(mime)) {
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

    const startKey: [string, number, string][] = [];

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
      startKey as unknown as string[],
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

      void tx.store.delete(cursor.primaryKey);

      cursor = await cursor.continue();
    }

    await tx.done;

    // delete payloads
    const tx2 = this.db!.transaction(["payload", "digestRef"], "readwrite");
    const digestRefStore = tx2.objectStore("digestRef");

    for (const digest of Object.keys(digestSet)) {
      const ref = await digestRefStore.get(digest);

      if (ref) {
        ref.count! -= digestSet[digest]!;
      }

      if (ref && ref.count! >= 1) {
        void digestRefStore.put(ref);
      } else {
        size += ref ? ref.size : 0;
        void digestRefStore.delete(digest);
        void tx2.objectStore("payload").delete(digest);
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

  getSkipCount(event: FetchEvent, url: string, method: string) {
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
