import {
  type LoadRecordFromSourceType,
  RemoteSourceArchiveDB,
} from "../remotearchivedb";
import { SingleRecordWARCLoader } from "../warcloader";
import { CDXLoader, CDX_COOKIE } from "../cdxloader";
import {
  AccessDeniedError,
  digestMessage,
  handleAuthNeeded,
  tsToDate,
  getTS,
} from "../utils";
import { type AsyncIterReader, getSurt } from "warcio";
import { LiveProxy } from "../liveproxy";

import { type IDBPTransaction, type IDBPDatabase } from "idb";

import {
  INDEX_CDX,
  INDEX_IDX,
  INDEX_NOT_LOADED,
  type IndexType,
  NO_LOAD_WACZ,
  WACZFile,
  type WACZFileInitOptions,
  type WACZFileOptions,
  type WACZLoadSource,
  WACZ_LEAF,
} from "./waczfile";
import { type DBType as ADBType } from "../archivedb";
import { EXTRA_PAGES_JSON, WACZImporter } from "./waczimporter";
import {
  type BaseLoader,
  type BlockLoaderOpts,
  createLoader,
} from "../blockloaders";
import { type ArchiveResponse } from "../response";
import { type ArchiveRequest } from "../request";
import { type LoadWACZEntry } from "./ziprangereader";

const MAX_BLOCKS = 3;

const IS_SURT = /^([\w-]+,)*[\w-]+(:\d+)?,?\)\//;

export type IDXLine = {
  waczname: string;
  prefix: string;
  filename: string;
  offset: number;
  length: number;
  digest?: string;
  loaded: boolean;
};

type Config = {
  dbname: string;
  noCache: boolean;
  decode?: unknown;
  metadata?: {
    textIndex?: string;
  };
  extraConfig?: {
    decodeResponses?: unknown;
    hostProxy?: boolean;
    fuzzy?: [RegExp | string, string][];
    textIndex?: string;
  };
};

interface MDBType extends ADBType {
  ziplines: {
    key: [string, string];
    value: unknown;
  };
  waczfiles: {
    key: string;
    value: unknown;
  };
  verification: {
    key: string;
    value: unknown;
  };
}

// ==========================================================================
export class MultiWACZ extends RemoteSourceArchiveDB implements WACZLoadSource {
  config: Config;
  waczfiles: Record<string, WACZFile>;
  waczNameForHash: Record<string, string>;
  ziploadercache: Record<string, Promise<void>>;
  updating: any | null;
  rootSourceType: "wacz" | "json";
  sourceLoader: BaseLoader | undefined;
  externalSource: LiveProxy | null;
  textIndex: string;
  fuzzyUrlRules: { match: RegExp; replace: any }[];

  constructor(
    config: Config,
    sourceLoader: BaseLoader,
    rootSourceType: "wacz" | "json" = "wacz"
  ) {
    // TODO @ikreymer it looks like we're passing `noCache` into what the `loader` param and not the `noCache` param, is there a loader that should be present here?
    // @ts-expect-error
    super(config.dbname, config.noCache);

    this.config = config;

    this.waczfiles = {};
    this.waczNameForHash = {};
    this.ziploadercache = {};

    this.updating = null;

    this.rootSourceType = rootSourceType;

    this.sourceLoader = sourceLoader;

    this.externalSource = null;
    this.fuzzyUrlRules = [];

    this.textIndex = config.metadata?.textIndex || EXTRA_PAGES_JSON;

    if (config.extraConfig) {
      this.initConfig(config.extraConfig);
    }
  }

  initConfig(extraConfig: NonNullable<Config["extraConfig"]>) {
    if (extraConfig.decodeResponses !== undefined) {
      this.config.decode = extraConfig.decodeResponses;
    }
    if (extraConfig.hostProxy) {
      this.externalSource = new LiveProxy(extraConfig, { hostProxyOnly: true });
    }
    if (extraConfig.fuzzy) {
      for (const [matchStr, replace] of extraConfig.fuzzy) {
        const match = new RegExp(matchStr);
        this.fuzzyUrlRules.push({ match, replace });
      }
    }
    if (extraConfig.textIndex) {
      this.textIndex = extraConfig.textIndex;
    }
  }

  override updateHeaders(headers: Record<string, string>) {
    if (this.sourceLoader) {
      this.sourceLoader.headers = headers;
    }
  }

  override _initDB(
    db: IDBPDatabase<MDBType>,
    oldV: number,
    newV: number,
    tx: IDBPTransaction<
      MDBType,
      (keyof MDBType)[],
      "readwrite" | "versionchange"
    >
  ) {
    super._initDB(db, oldV, newV, tx);

    if (!oldV) {
      db.createObjectStore("ziplines", { keyPath: ["waczname", "prefix"] });

      db.createObjectStore("waczfiles", { keyPath: "waczname" });

      db.createObjectStore("verification", { keyPath: "id" });
    }

    if (oldV === 2) {
      this.convertV2WACZDB(db, tx);
    }

    if (oldV === 3) {
      db.createObjectStore("verification", { keyPath: "id" });
    }
  }

  async convertV2WACZDB(db: any, tx: any) {
    try {
      const ziplines = await tx.objectStore("ziplines").getAll();
      const entries = await tx.objectStore("zipEntries").getAll();

      db.deleteObjectStore("ziplines");

      db.deleteObjectStore("zipEntries");

      db.createObjectStore("ziplines", { keyPath: ["waczname", "prefix"] });

      db.createObjectStore("waczfiles", { keyPath: "waczname" });

      db.createObjectStore("verification", { keyPath: "id" });

      const waczname = this.config.loadUrl;

      for (const line of ziplines) {
        line.waczname = waczname;
        tx.objectStore("ziplines").put(line);
      }

      const indexType = ziplines.length > 0 ? INDEX_IDX : INDEX_CDX;
      const hash = await this.computeFileHash(waczname, "");
      const filedata = new WACZFile({
        waczname,
        hash,
        path: waczname,
        entries,
        indexType,
      });

      tx.objectStore("waczfiles").put(filedata.serialize());

      await tx.done;
    } catch (e) {
      console.warn(e);
    }
  }

  addWACZFile(file: WACZFileOptions) {
    this.waczfiles[file.waczname] = new WACZFile(file);
    this.waczNameForHash[file.hash] = file.waczname;
    return this.waczfiles[file.waczname];
  }

  override async init() {
    await super.init();

    const fileDatas = (await this.db!.getAll("waczfiles")) || [];

    for (const file of fileDatas) {
      this.addWACZFile({ ...file, parent: this });
    }

    for (const [key, value] of Object.entries(this.waczfiles)) {
      value.path = value.path || key;

      // nested wacz will contain '#!/'
      const inx = value.path.lastIndexOf("#!/");
      if (inx > 0) {
        const parentName = value.path.slice(0, inx);
        const parent = this.waczfiles[parentName];
        value.parent = parent;
      } else if (this.rootSourceType !== "json") {
        value.loader = this.sourceLoader;
      }
    }

    await this.checkUpdates();
  }

  override async close() {
    super.close();
    caches.delete("cache:" + this.name.slice("db:".length));
  }

  async clearZipData() {
    const stores = ["waczfiles", "ziplines"];

    for (const store of stores) {
      await this.db!.clear(store);
    }
  }

  override async addVerifyData(
    prefix = "",
    id: string,
    expected: string,
    actual: string | null = null,
    log = false
  ) {
    let matched = false;

    if (prefix) {
      id = prefix + id;
    }

    if (actual) {
      matched = expected === actual;
      if (log) {
        console.log(`verify ${id}: ${matched}`);
      }
    }
    await this.db!.put("verification", { id, expected, matched });
  }

  override async addVerifyDataList(prefix: string, datalist: any[]) {
    const tx = this.db!.transaction("verification", "readwrite");

    for (const data of datalist) {
      if (prefix) {
        data.id = prefix + data.id;
      }
      tx.store.put(data);
    }

    try {
      await tx.done;
    } catch (e) {
      console.warn(e);
    }
  }

  override async getVerifyInfo() {
    const results = await this.db!.getAll("verification");

    let numValid = 0;
    let numInvalid = 0;

    const info: Record<string, any> = {};

    const includeProps = [
      "domain",
      "created",
      "certFingerprint",
      "software",
      "datapackageHash",
      "publicKey",
    ];

    for (const res of results) {
      if (includeProps.includes(res.id)) {
        info[res.id] = res.expected;
      } else if (res.id === "signature") {
        numValid++;
      } else if (res.matched === true) {
        numValid++;
      } else if (res.matched === false) {
        numInvalid++;
      }
    }

    info.numInvalid = numInvalid;
    info.numValid = numValid;

    return info;
  }

  async getVerifyExpected(id: string) {
    const res = await this.db!.get("verification", id);
    return res?.expected;
  }

  override async clearAll() {
    await super.clearAll();

    await this.clearZipData();
  }

  override async loadRecordFromSource(
    cdx: Record<string, any>
  ): LoadRecordFromSourceType {
    const { start, length, path, wacz } = cdx.source;
    const params = { offset: start, length, unzip: true, computeHash: true };
    const waczname = wacz;

    const { reader, hasher } = await this.loadFileFromNamedWACZ(
      waczname,
      "archive/" + path,
      params
    );

    const loader = new SingleRecordWARCLoader(reader);

    await this.waczfiles[waczname].save(this.db);

    const remote = await loader.load();

    if (cdx[CDX_COOKIE] && remote?.respHeaders) {
      remote.respHeaders["x-wabac-preset-cookie"] = cdx[CDX_COOKIE];
    }

    return { remote, hasher };
  }

  async loadIndex(waczname: string) {
    if (!this.waczfiles[waczname]) {
      throw new Error("unknown waczfile: " + waczname);
    }

    if (this.waczfiles[waczname].indexType) {
      return { indexType: this.waczfiles[waczname].indexType, isNew: false };
    }

    //const indexloaders = [];
    let indexType = INDEX_NOT_LOADED;

    // load CDX and IDX
    for (const filename of this.waczfiles[waczname].iterContainedFiles()) {
      if (filename.endsWith(".cdx") || filename.endsWith(".cdxj")) {
        console.log(`Loading CDX for ${waczname}`);

        await this.loadCDX(filename, waczname);

        indexType = INDEX_CDX;
      } else if (filename.endsWith(".idx")) {
        // For compressed indices
        console.log(`Loading IDX for ${waczname}`);

        await this.loadIDX(filename, waczname);

        indexType = INDEX_IDX;
      }
    }

    this.waczfiles[waczname].indexType = indexType as IndexType;

    await this.waczfiles[waczname].save(this.db, true);

    return { indexType, isNew: true };
  }

  async loadCDX(
    filename: string,
    waczname: string,
    progressUpdate?: any,
    total?: number
  ) {
    const { reader, hasher } = await this.loadFileFromNamedWACZ(
      waczname,
      filename,
      { computeHash: true }
    );

    const loader = new CDXLoader(reader, null, waczname, { wacz: waczname });

    const res = await loader.load(this, progressUpdate, total);

    if (hasher) {
      const expected = await this.getVerifyExpected(filename);
      if (expected) {
        this.addVerifyData(waczname, filename, expected, hasher.getHash());
      }
    }

    return res;
  }

  async loadIDX(
    filename: string,
    waczname: string,
    progressUpdate?: any,
    total?: number
  ): Promise<void> {
    const { reader, hasher } = await this.loadFileFromNamedWACZ(
      waczname,
      filename,
      { computeHash: true }
    );

    const batch: IDXLine[] = [];
    let defaultFilename = "";

    // start out as non surt, if surt detected, set to false
    let nonSurt = true;

    let currOffset = 0;

    for await (const line of reader.iterLines()) {
      currOffset += line.length;

      // first line
      if (currOffset === line.length) {
        if (line.startsWith("!meta")) {
          const inx = line.indexOf(" {");
          if (inx < 0) {
            console.warn("Invalid Meta Line: " + line);
            continue;
          }

          const indexMetadata = JSON.parse(line.slice(inx));

          if (indexMetadata.filename) {
            defaultFilename = indexMetadata.filename;
          }
          if (indexMetadata.format !== "cdxj-gzip-1.0") {
            console.log(
              `Unknown CDXJ format "${indexMetadata.format}", archive may not parse correctly`
            );
          }
          continue;
        }
      }

      let entry: IDXLine;

      if (line.indexOf("\t") > 0) {
        const [prefix, filename, offsetStr, lengthStr] = line.split("\t");
        const offset = Number(offsetStr);
        const length = Number(lengthStr);

        entry = { waczname, prefix, filename, offset, length, loaded: false };

        nonSurt = false;
      } else {
        const inx = line.indexOf(" {");
        if (inx < 0) {
          console.log("Invalid Index Line: " + line);
          continue;
        }

        const prefix = line.slice(0, inx);
        let { offset, length, filename, digest } = JSON.parse(line.slice(inx));

        nonSurt = nonSurt && !IS_SURT.test(prefix);

        filename = filename || defaultFilename;

        entry = {
          waczname,
          prefix,
          filename,
          offset,
          length,
          digest,
          loaded: false,
        };
      }

      if (progressUpdate && total) {
        progressUpdate(currOffset / total, currOffset, total);
      }

      batch.push(entry);
    }

    if (hasher) {
      const expected = await this.getVerifyExpected(filename);
      if (expected) {
        this.addVerifyData(waczname, filename, expected, hasher.getHash());
      }
    }

    const tx = this.db!.transaction("ziplines", "readwrite");

    for (const entry of batch) {
      tx.store.put(entry);
    }

    try {
      await tx.done;
    } catch (e) {
      console.log("Error loading ziplines index: ", e);
    }

    // set only if nonSurt is true (defaults to false)
    if (nonSurt && nonSurt !== this.waczfiles[waczname].nonSurt) {
      this.waczfiles[waczname].nonSurt = nonSurt;
      await this.waczfiles[waczname].save(this.db, true);
    }
  }

  async loadCDXFromIDX(
    waczname: string,
    url: string,
    datetime = 0,
    isPrefix = false
  ) {
    //const timestamp = datetime ? getTS(new Date(datetime).toISOString()) : "";

    const surt = this.waczfiles[waczname].nonSurt ? url : getSurt(url);

    const upperBound = isPrefix ? this.prefixUpperBound(surt) : surt + " 9999";

    const key = IDBKeyRange.upperBound([waczname, upperBound], true);

    const tx = this.db!.transaction("ziplines", "readonly");

    const values: IDXLine[] = [];

    for await (const cursor of tx.store.iterate(key, "prev")) {
      // restrict to specific waczname
      if (cursor.value.waczname !== waczname) {
        break;
      }

      // add to beginning as processing entries in reverse here
      values.unshift(cursor.value);
      if (!cursor.value.prefix.split(" ")[0].startsWith(surt)) {
        break;
      }
    }

    await tx.done;

    const cdxloaders: Promise<void>[] = [];

    if (values.length > MAX_BLOCKS && datetime) {
      values.sort((a, b) => {
        const ts1 = a.prefix.split(" ")[1];
        const ts2 = b.prefix.split(" ")[1];
        if (!ts1 || !ts2) {
          return 0;
        }
        const diff1 = Math.abs(tsToDate(ts1).getTime() - datetime);
        const diff2 = Math.abs(tsToDate(ts2).getTime() - datetime);
        if (diff1 === diff2) {
          return 0;
        }
        return diff1 < diff2 ? -1 : 1;
      });
    }

    let count = 0;

    for (const zipblock of values) {
      if (zipblock.loaded) {
        continue;
      }

      const cacheKey =
        waczname + ":" + zipblock.filename + ":" + zipblock.offset;

      let cachedLoad = this.ziploadercache[cacheKey];

      if (!cachedLoad) {
        cachedLoad = this.doCDXLoad(cacheKey, zipblock, waczname);
        this.ziploadercache[cacheKey] = cachedLoad;
      }
      cdxloaders.push(cachedLoad);

      if (++count > MAX_BLOCKS) {
        break;
      }
    }

    if (cdxloaders.length) {
      await Promise.allSettled(cdxloaders);
    }

    await this.waczfiles[waczname].save(this.db);

    return cdxloaders.length > 0;
  }

  async doCDXLoad(
    cacheKey: string,
    zipblock: IDXLine,
    waczname: string
  ): Promise<void> {
    try {
      const filename = "indexes/" + zipblock.filename;
      const params = {
        offset: zipblock.offset,
        length: zipblock.length,
        unzip: true,
        computeHash: !!zipblock.digest,
      };
      const { reader, hasher } = await this.loadFileFromNamedWACZ(
        waczname,
        filename,
        params
      );

      const loader = new CDXLoader(reader, null, "", { wacz: waczname });
      await loader.load(this);

      if (hasher) {
        const hash = hasher.getHash();
        const id = `${filename}:${zipblock.offset}-${zipblock.length}`;
        await this.addVerifyData(waczname, id, zipblock.digest || "", hash);
      }

      zipblock.loaded = true;
      await this.db!.put("ziplines", zipblock);
    } catch (e) {
      if (!(await handleAuthNeeded(e, this.config))) {
        console.warn(e);
      }
    } finally {
      delete this.ziploadercache[cacheKey];
    }
  }

  async findPageAtUrl(url: string, ts: number) {
    const pages = await this.db!.getAllFromIndex("pages", "url", url);
    let currPage = null;
    let minDiff = Number.MAX_SAFE_INTEGER;

    for (const page of pages) {
      const diff = Math.abs(page.ts - ts);
      if (diff < 1000) {
        return page;
      }
      if (diff < minDiff) {
        currPage = page;
        minDiff = diff;
      }
    }

    return currPage;
  }

  override async lookupUrl(
    url: string,
    datetime: number,
    opts: Record<string, any> = {}
  ) {
    try {
      const { waczname } = opts;

      let result;

      if (waczname && waczname !== NO_LOAD_WACZ) {
        result = await this.lookupUrlForWACZ(waczname, url, datetime, opts);
      }

      if (result && (!opts.noRevisits || result.mime !== "warc/revisit")) {
        return result;
      }

      result = await super.lookupUrl(url, datetime, opts);

      return result;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  async lookupUrlForWACZ(
    waczname: string,
    url: string,
    datetime: number,
    opts: Record<string, any>
  ) {
    const { indexType, isNew } = await this.loadIndex(waczname);

    switch (indexType) {
      case INDEX_IDX:
        if (!(await this.loadCDXFromIDX(waczname, url, datetime, false))) {
          // no new idx lines loaded
          return null;
        }
        break;

      case INDEX_CDX:
        if (!isNew) {
          return null;
        }
        break;

      default:
        return null;
    }

    return await super.lookupUrl(url, datetime, opts);
  }

  override async resourcesByUrlAndMime(
    url: string,
    ...args: [string, number, boolean, string, string]
  ) {
    let results = await super.resourcesByUrlAndMime(url, ...args);

    if (results.length > 0) {
      return results;
    }

    for (const waczname of Object.keys(this.waczfiles)) {
      if (waczname && waczname !== "local") {
        const { indexType, isNew } = await this.loadIndex(waczname);

        switch (indexType) {
          case INDEX_IDX:
            if (!(await this.loadCDXFromIDX(waczname, url, 0, true))) {
              // no new idx lines loaded
              continue;
            }
            break;

          case INDEX_CDX:
            if (!isNew) {
              continue;
            }
            break;

          default:
            continue;
        }

        const newRes = await super.resourcesByUrlAndMime(url, ...args);
        if (newRes && newRes.length) {
          results = results.concat(newRes);
        }
      }
    }

    return results;
  }

  async loadFileFromWACZ(
    waczfile: WACZFile,
    filename: string,
    opts: Record<string, any>
  ): LoadWACZEntry {
    try {
      return await waczfile.loadFile(filename, opts);
    } catch (e) {
      if (await this.retryLoad(e)) {
        return await waczfile.loadFile(filename, opts);
      } else {
        throw e;
      }
    }
  }

  async loadFileFromNamedWACZ(
    waczname: string,
    filename: string,
    opts: Record<string, any>
  ): LoadWACZEntry {
    const waczfile = this.waczfiles[waczname];

    if (!waczfile) {
      throw new Error("No WACZ Found for: " + waczname);
    }

    return await this.loadFileFromWACZ(waczfile, filename, opts);
  }

  async computeFileHash(waczname: string, hash?: string): Promise<string> {
    if (!hash) {
      hash = await digestMessage(waczname, "sha-256", "");
    } else if (hash.indexOf(":") > 0) {
      hash = hash.split(":")[1];
    }
    return hash;
  }

  async addNewWACZ({
    name,
    hash,
    path,
    parent,
    loader = null,
  }: WACZFileInitOptions & { name: string }) {
    const waczname = name || path || "";

    hash = await this.computeFileHash(waczname, hash);

    const file = this.addWACZFile({ waczname, hash, path, parent, loader });

    await file.init();

    await file.save(this.db, true);

    const importer = new WACZImporter(this, file, !parent);

    return await importer.load();
  }

  async loadWACZFiles(
    json: Record<string, any>,
    parent: WACZLoadSource = this
  ) {
    const promises: Promise<void>[] = [];

    const update = async (name: string, path: string) => {
      await this.waczfiles[name].init(path);
      await this.waczfiles[name].save(this.db, true);
    };

    const files = json.resources.map(
      (res: { path: string; name: string; hash: string }) => {
        const path = parent.getLoadPath(res.path);
        const name = parent.getName(res.name);
        const hash = res.hash;
        return { name, hash, path };
      }
    );

    for (const { name, hash, path } of files) {
      if (!this.waczfiles[name]) {
        promises.push(this.addNewWACZ({ name, hash, path, parent }));
      } else if (this.waczfiles[name].path !== path) {
        promises.push(update(name, path));
      }
    }

    if (promises.length) {
      await Promise.allSettled(promises);
    }
  }

  async getTextIndex() {
    const headers: Record<string, string> = {
      "Content-Type": "application/ndjson",
    };

    const keys = Object.keys(this.waczfiles);

    if (!this.textIndex || !keys.length) {
      return new Response("", { headers });
    }

    if (keys.length === 1) {
      const waczname = keys[0];

      let result;

      try {
        result = await this.loadFileFromNamedWACZ(waczname, this.textIndex, {
          unzip: true,
        });
      } catch (e) {
        return new Response("", { headers });
      }

      const { reader } = result;

      const size = this.waczfiles[waczname].getSizeOf(this.textIndex);

      if (size > 0) {
        headers["Content-Length"] = "" + size;
      }

      return new Response(reader.getReadableStream(), { headers });
    } else {
      const readers: AsyncIterReader[] = [];

      for (const waczname of keys) {
        try {
          const { reader } = await this.loadFileFromNamedWACZ(
            waczname,
            this.textIndex,
            { unzip: true }
          );
          if (reader) {
            readers.push(reader);
          }
        } catch (e) {
          continue;
        }
      }

      const rs = new ReadableStream({
        async pull(controller) {
          for (const reader of readers) {
            for await (const chunk of reader) {
              controller.enqueue(chunk);
            }
          }
          controller.close();
        },
      });

      return new Response(rs, { headers });
    }
  }

  override async getResource(
    request: ArchiveRequest,
    prefix: string,
    event: FetchEvent,
    { pageId }: Record<string, any> = {}
  ): Promise<ArchiveResponse | Response | null> {
    await this.initing;

    if (this.externalSource) {
      const res = await this.externalSource.getResource(request, prefix);
      if (res) {
        return res;
      }
    }

    const hash = pageId;
    let waczname: string | null = null;

    let resp: ArchiveResponse | Response | null = null;

    if (hash) {
      waczname = this.waczNameForHash[hash];
      if (!waczname) {
        return null;
      }
      resp = await super.getResource(request, prefix, event, { waczname });
      if (resp) {
        return resp;
      }
    }

    const foundMap = new Map();

    for (const [name, file] of Object.entries(this.waczfiles)) {
      if (file.fileType !== WACZ_LEAF) {
        continue;
      }

      // already checked this file above, don't check again
      if (file.hash === hash) {
        continue;
      }

      resp = await super.getResource(request, prefix, event, {
        waczname: name,
        noFuzzyCheck: true,
        loadFirst: true,
      });
      if (resp) {
        foundMap.set((resp as ArchiveResponse).date, { name, hash: file.hash });
      }
    }

    if (foundMap.size > 0) {
      const requestTS = tsToDate(request.timestamp);
      let min = -1;
      let ts;
      let foundHash;

      for (const date of foundMap.keys()) {
        const dist = Math.abs(date.getTime() - requestTS.getTime());
        if (min < 0 || dist < min) {
          const { name, hash } = foundMap.get(date);
          waczname = name;
          foundHash = hash;
          ts = getTS(date.toISOString());
          min = dist;
        }
      }

      return Response.redirect(
        `${prefix}:${foundHash}/${ts}mp_/${request.url}`
      );
    }

    if (this.fuzzyUrlRules.length) {
      for (const { match, replace } of this.fuzzyUrlRules) {
        const newUrl = decodeURIComponent(request.url.replace(match, replace));
        if (newUrl && newUrl !== request.url) {
          request.url = newUrl;
          const res = await super.getResource(request, prefix, event);
          if (res) {
            return res;
          }
        }
      }
    }

    return null;
  }
  async retryLoad(e: any) {
    if (this.rootSourceType !== "json") {
      return false;
    }

    if (e instanceof AccessDeniedError) {
      if (!this.updating) {
        this.updating = this.checkUpdates();
      }
      await this.updating;
      this.updating = null;
      return true;
    } else {
      return await handleAuthNeeded(e, this.config);
    }
  }

  async checkUpdates() {
    if (this.rootSourceType === "json") {
      await this.loadFromJSON();
    }
  }

  async loadFromJSON(response: Response | null = null) {
    if (!response) {
      const result = await this.sourceLoader.doInitialFetch(false, false);
      response = result && result.response;
    }

    if (!response || (response.status !== 206 && response.status !== 200)) {
      console.warn("WACZ update failed from: " + this.config.loadUrl);
      return {};
    }

    const data = await response.json();

    switch (data.profile) {
      case "data-package":
      case "wacz-package":
      //eslint: disable=no-fallthrough
      default:
        await this.loadWACZFiles(data);
    }

    return data;
  }

  getLoadPath(path: string) {
    return new URL(path, this.config.loadUrl).href;
  }

  getName(name: string) {
    return name;
  }

  async createLoader(opts: BlockLoaderOpts): Promise<BaseLoader> {
    return await createLoader(opts);
  }
}
