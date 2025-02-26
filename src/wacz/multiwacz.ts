import {
  type LoadRecordFromSourceType,
  OnDemandPayloadArchiveDB,
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
import { type ADBType } from "../archivedb";
import { EXTRA_PAGES_JSON, WACZImporter } from "./waczimporter";
import {
  type BaseLoader,
  type BlockLoaderOpts,
  createLoader,
} from "../blockloaders";
import { type ArchiveResponse } from "../response";
import { type ArchiveRequest } from "../request";
import { type LoadWACZEntry } from "./ziprangereader";
import {
  type PageEntry,
  type RemoteResourceEntry,
  type WACZCollConfig,
} from "../types";

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

export type PreloadResources = {
  name: string;
  crawlId: string;
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
export class MultiWACZ
  extends OnDemandPayloadArchiveDB
  implements WACZLoadSource
{
  config: WACZCollConfig;
  waczfiles: Record<string, WACZFile>;
  waczNameForHash: Record<string, string>;
  ziploadercache: Record<string, Promise<void>>;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents
  updating: any | null;
  rootSourceType: "wacz" | "json";
  sourceLoader: BaseLoader | undefined;
  externalSource: LiveProxy | null;
  textIndex: string;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fuzzyUrlRules: { match: RegExp; replace: any }[];

  pagesQueryUrl = "";

  totalPages?: number = undefined;

  preloadResources: string[] = [];
  seedPageWACZs: Map<string, Set<string>> = new Map<string, Set<string>>();

  constructor(
    config: WACZCollConfig,
    sourceLoader: BaseLoader,
    rootSourceType: "wacz" | "json" = "wacz",
  ) {
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

  initConfig(extraConfig: NonNullable<WACZCollConfig["extraConfig"]>) {
    if (extraConfig.decodeResponses !== undefined) {
      this.config.decode = !!extraConfig.decodeResponses;
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

  updateHeaders(headers: Record<string, string>) {
    if (this.sourceLoader) {
      this.sourceLoader.headers = headers;
    }
  }

  // @ts-expect-error [TODO @emma-sg] - TS2416 - Property '_initDB' in type 'MultiWACZ' is not assignable to the same property in base type 'RemoteSourceArchiveDB'.
  override _initDB(
    db: IDBPDatabase<MDBType>,
    oldV: number,
    newV: number,
    tx: IDBPTransaction<
      MDBType,
      (keyof MDBType)[],
      "readwrite" | "versionchange"
    >,
  ) {
    // @ts-expect-error [TODO @emma-sg] - TS2345 - Argument of type 'IDBPDatabase<MDBType>' is not assignable to parameter of type 'IDBPDatabase<DBType>'.
    super._initDB(db, oldV, newV, tx);

    if (!oldV) {
      db.createObjectStore("ziplines", { keyPath: ["waczname", "prefix"] });

      db.createObjectStore("waczfiles", { keyPath: "waczname" });

      db.createObjectStore("verification", { keyPath: "id" });
    }

    if (oldV === 2) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.convertV2WACZDB(db, tx);
    }

    if (oldV === 3) {
      db.createObjectStore("verification", { keyPath: "id" });
    }
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const waczfile = new WACZFile(file);
    this.waczfiles[file.waczname] = waczfile;
    this.waczNameForHash[file.hash] = file.waczname;
    return waczfile;
  }

  override async init() {
    await super.init();

    // @ts-expect-error [TODO] - TS2345 - Argument of type '"waczfiles"' is not assignable to parameter of type 'StoreNames<DBType>'.
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const fileDatas = (await this.db!.getAll("waczfiles")) || [];

    for (const file of fileDatas) {
      // @ts-expect-error [TODO] - TS2345 - Argument of type '{ parent: this; } | { parent: this; url: string; ts: number; digest?: string | null | undefined; status?: number | undefined; mime?: string | undefined; respHeaders?: Record<string, string> | null | undefined; ... 15 more ...; "req.http:cookie"?: string | undefined; } | ... 4 more ... | { ...; }' is not assignable to parameter of type 'WACZFileOptions'.
      this.addWACZFile({ ...file, parent: this });
    }

    for (const [key, value] of Object.entries(this.waczfiles)) {
      value.path = value.path || key;

      // nested wacz will contain '#!/'
      const inx = value.path.lastIndexOf("#!/");
      if (inx > 0) {
        const parentName = value.path.slice(0, inx);
        const parent = this.waczfiles[parentName];
        // @ts-expect-error [TODO] - TS2322 - Type 'WACZFile | undefined' is not assignable to type 'WACZLoadSource | null'.
        value.parent = parent;
      } else if (this.rootSourceType !== "json") {
        // @ts-expect-error [TODO] - TS2322 - Type 'BaseLoader | undefined' is not assignable to type 'BaseLoader | null'.
        value.loader = this.sourceLoader;
      }
    }

    await this.checkUpdates();
  }

  override async close() {
    super.close();
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    caches.delete("cache:" + this.name.slice("db:".length));
  }

  async clearZipData() {
    const stores = ["waczfiles", "ziplines"];

    for (const store of stores) {
      // @ts-expect-error [TODO] - TS2345 - Argument of type 'string' is not assignable to parameter of type 'StoreNames<DBType>'.
      await this.db!.clear(store);
    }
  }

  override async addVerifyData(
    prefix = "",
    id: string,
    expected: string,
    actual: string | null = null,
    log = false,
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
    // @ts-expect-error [TODO] - TS2345 - Argument of type '"verification"' is not assignable to parameter of type 'StoreNames<DBType>'.
    await this.db!.put("verification", { id, expected, matched });
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async addVerifyDataList(prefix: string, datalist: any[]) {
    // @ts-expect-error [TODO] - TS2769 - No overload matches this call.
    const tx = this.db!.transaction("verification", "readwrite");

    for (const data of datalist) {
      if (prefix) {
        data.id = prefix + data.id;
      }
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-argument
      tx.store.put(data);
    }

    try {
      await tx.done;
    } catch (e) {
      console.warn(e);
    }
  }

  override async getVerifyInfo() {
    // @ts-expect-error [TODO] - TS2345 - Argument of type '"verification"' is not assignable to parameter of type 'StoreNames<DBType>'.
    const results = await this.db!.getAll("verification");

    let numValid = 0;
    let numInvalid = 0;

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // @ts-expect-error [TODO] - TS2531 - Object is possibly 'null'. | TS2339 - Property 'id' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'.
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (includeProps.includes(res.id)) {
        // @ts-expect-error [TODO] - TS2531 - Object is possibly 'null'. | TS2339 - Property 'id' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'. | TS2531 - Object is possibly 'null'. | TS2339 - Property 'expected' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'.
        info[res.id] = res.expected;
        // @ts-expect-error [TODO] - TS2531 - Object is possibly 'null'. | TS2339 - Property 'id' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'.
      } else if (res.id === "signature") {
        numValid++;
        // @ts-expect-error [TODO] - TS2531 - Object is possibly 'null'. | TS2339 - Property 'matched' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'.
      } else if (res.matched === true) {
        numValid++;
        // @ts-expect-error [TODO] - TS2531 - Object is possibly 'null'. | TS2339 - Property 'matched' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'.
      } else if (res.matched === false) {
        numInvalid++;
      }
    }

    // @ts-expect-error [TODO] - TS4111 - Property 'numInvalid' comes from an index signature, so it must be accessed with ['numInvalid'].
    info.numInvalid = numInvalid;
    // @ts-expect-error [TODO] - TS4111 - Property 'numValid' comes from an index signature, so it must be accessed with ['numValid'].
    info.numValid = numValid;

    return info;
  }

  async getVerifyExpected(id: string) {
    // @ts-expect-error [TODO] - TS2345 - Argument of type '"verification"' is not assignable to parameter of type 'StoreNames<DBType>'.
    const res = await this.db!.get("verification", id);
    // @ts-expect-error [TODO] - TS2339 - Property 'expected' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'.
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return res?.expected;
  }

  override async clearAll() {
    await super.clearAll();

    await this.clearZipData();
  }

  override async loadRecordFromSource(
    cdx: RemoteResourceEntry,
  ): LoadRecordFromSourceType {
    const { start, length, path, wacz } = cdx.source;
    const params = { offset: start, length, unzip: true, computeHash: true };
    const waczname = wacz!;

    const { reader, hasher } = await this.loadFileFromNamedWACZ(
      waczname,
      "archive/" + path,
      params,
    );

    const loader = new SingleRecordWARCLoader(reader);

    // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
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

    if (!this.waczfiles[waczname].entries) {
      await this.waczfiles[waczname].init();
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
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progressUpdate?: any,
    total?: number,
  ) {
    const { reader, hasher } = await this.loadFileFromNamedWACZ(
      waczname,
      filename,
      { computeHash: true },
    );

    const loader = new CDXLoader(reader, null, waczname, { wacz: waczname });

    const res = await loader.load(this, progressUpdate, total);

    if (hasher) {
      const expected = await this.getVerifyExpected(filename);
      if (expected) {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-argument
        this.addVerifyData(waczname, filename, expected, hasher.getHash());
      }
    }

    return res;
  }

  async loadIDX(
    filename: string,
    waczname: string,
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progressUpdate?: any,
    total?: number,
  ): Promise<void> {
    const { reader, hasher } = await this.loadFileFromNamedWACZ(
      waczname,
      filename,
      { computeHash: true },
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
              `Unknown CDXJ format "${indexMetadata.format}", archive may not parse correctly`,
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

        // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string'.
        entry = { waczname, prefix, filename, offset, length, loaded: false };

        nonSurt = false;
      } else {
        const inx = line.indexOf(" {");
        if (inx < 0) {
          console.log("Invalid Index Line: " + line);
          continue;
        }

        const prefix = line.slice(0, inx);
        // [TODO]
        // eslint-disable-next-line prefer-const
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
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-argument
        this.addVerifyData(waczname, filename, expected, hasher.getHash());
      }
    }

    // @ts-expect-error [TODO] - TS2769 - No overload matches this call.
    const tx = this.db!.transaction("ziplines", "readwrite");

    for (const entry of batch) {
      // @ts-expect-error [TODO] - TS2345 - Argument of type 'IDXLine' is not assignable to parameter of type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; } | null'.
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      tx.store.put(entry);
    }

    try {
      await tx.done;
    } catch (e) {
      console.log("Error loading ziplines index: ", e);
    }

    // set only if nonSurt is true (defaults to false)
    // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
    if (nonSurt && nonSurt !== this.waczfiles[waczname].nonSurt) {
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      this.waczfiles[waczname].nonSurt = nonSurt;
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      await this.waczfiles[waczname].save(this.db, true);
    }
  }

  async loadCDXFromIDX(
    waczname: string,
    url: string,
    datetime = 0,
    isPrefix = false,
  ) {
    //const timestamp = datetime ? getTS(new Date(datetime).toISOString()) : "";

    // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
    const surt = this.waczfiles[waczname].nonSurt ? url : getSurt(url);

    const upperBound = isPrefix ? this.prefixUpperBound(surt) : surt + " 9999";

    const key = IDBKeyRange.upperBound([waczname, upperBound], true);

    // @ts-expect-error [TODO] - TS2769 - No overload matches this call.
    const tx = this.db!.transaction("ziplines", "readonly");

    const values: IDXLine[] = [];

    for await (const cursor of tx.store.iterate(key, "prev")) {
      // restrict to specific waczname
      // @ts-expect-error [TODO] - TS2531 - Object is possibly 'null'. | TS2339 - Property 'waczname' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'.
      if (cursor.value.waczname !== waczname) {
        break;
      }

      // add to beginning as processing entries in reverse here
      // @ts-expect-error [TODO] - TS2345 - Argument of type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; } | null' is not assignable to parameter of type 'IDXLine'.
      values.unshift(cursor.value);
      // @ts-expect-error [TODO] - TS2531 - Object is possibly 'null'. | TS2339 - Property 'prefix' does not exist on type 'ResourceEntry | PageEntry | DigestRefCount | (PageEntry & { size?: number | undefined; }) | { pages?: unknown[] | undefined; show?: boolean | undefined; title?: string | undefined; desc?: string | undefined; slug?: string | undefined; } | { ...; }'.
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

    // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
    await this.waczfiles[waczname].save(this.db);

    return cdxloaders.length > 0;
  }

  async doCDXLoad(
    cacheKey: string,
    zipblock: IDXLine,
    waczname: string,
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
        params,
      );

      const loader = new CDXLoader(reader, null, "", { wacz: waczname });
      await loader.load(this);

      if (hasher) {
        const hash = hasher.getHash();
        const id = `${filename}:${zipblock.offset}-${zipblock.length}`;
        await this.addVerifyData(waczname, id, zipblock.digest || "", hash);
      }

      zipblock.loaded = true;
      // @ts-expect-error [TODO] - TS2345 - Argument of type '"ziplines"' is not assignable to parameter of type 'StoreNames<DBType>'.
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
      // @ts-expect-error [TODO] - TS2362 - The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type. | TS2532 - Object is possibly 'undefined'.
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
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: Record<string, any> = {},
  ) {
    try {
      const { waczname } = opts;

      let result;

      if (waczname && waczname !== NO_LOAD_WACZ) {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        result = await this.lookupUrlForWACZ(waczname, url, datetime, opts);
      }

      // @ts-expect-error [TODO] - TS4111 - Property 'noRevisits' comes from an index signature, so it must be accessed with ['noRevisits'].
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
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: Record<string, any>,
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
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain
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
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: Record<string, any>,
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
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: Record<string, any>,
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
    // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string'.
    return hash;
  }

  async addNewWACZ({
    name,
    hash,
    path,
    crawlId,
    parent,
    loader = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }: WACZFileInitOptions & { name: string }): Promise<Record<string, any>> {
    const waczname = name || path || "";

    hash = await this.computeFileHash(waczname, hash);

    const file = this.addWACZFile({
      waczname,
      hash,
      crawlId,
      path,
      parent,
      loader,
    });

    if (!this.pagesQueryUrl) {
      await file.init();
    }

    await file.save(this.db, true);

    if (!this.pagesQueryUrl) {
      const importer = new WACZImporter(this, file, !parent);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return await importer.load();
    } else {
      return {};
    }
  }

  async loadWACZFiles(
    // [TODO]

    json: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resources: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialPages: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      preloadResources: any;
      totalPages: number;
    },
    parent: WACZLoadSource = this,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promises: Promise<any>[] = [];

    const update = async (name: string, path: string) => {
      const waczfile = this.waczfiles[name];
      if (!waczfile) {
        return;
      }
      if (!this.pagesQueryUrl) {
        waczfile.path = path;
      } else {
        await waczfile.init(path);
      }
      await waczfile.save(this.db, true);
    };

    const files = json.resources.map(
      (res: { path: string; name: string; hash: string; crawlId?: string }) => {
        const path = parent.getLoadPath(res.path);
        const name = parent.getName(res.name);
        const hash = res.hash;
        const crawlId = res.crawlId;
        return { name, hash, path, crawlId };
      },
    );

    for (const { name, hash, path, crawlId } of files) {
      if (!this.waczfiles[name]) {
        promises.push(this.addNewWACZ({ name, hash, path, parent, crawlId }));
      } else if (this.waczfiles[name].path !== path) {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        promises.push(update(name, path));
      }
    }

    if (promises.length) {
      await Promise.allSettled(promises);
    }

    if (json.preloadResources) {
      for (const { name } of json.preloadResources) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.preloadResources.push(name);
      }
    }

    if (json.initialPages) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await this.addInitialPages(json.initialPages);
    }

    if (!isNaN(json.totalPages)) {
      this.totalPages = json.totalPages;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async addInitialPages(pagesImport: Record<string, any>[]) {
    const pages: PageEntry[] = [];
    for (const {
      id,
      url,
      title,
      ts,
      mime,
      status,
      depth,
      favIconUrl,
      filename,
      isSeed,
      crawl_id,
    } of pagesImport) {
      const file = this.waczfiles[filename];
      const waczhash = file ? file.hash : "";
      pages.push({
        id,
        url,
        title,
        ts,
        mime,
        status,
        depth,
        favIconUrl,
        wacz: filename,
        waczhash,
        isSeed,
      });
      if (isSeed) {
        const set: Set<string> =
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          this.seedPageWACZs.get(crawl_id) || new Set<string>();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        set.add(filename);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.seedPageWACZs.set(crawl_id, set);
      }
    }

    return await this.addPages(pages);
  }

  async getTextIndex() {
    const headers: Record<string, string> = {
      "Content-Type": "application/ndjson",
    };

    const keys = Object.keys(this.waczfiles);

    if (this.pagesQueryUrl || !this.textIndex || !keys.length) {
      return new Response("", { headers });
    }

    if (keys.length === 1) {
      const waczname = keys[0];

      let result;

      try {
        // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
        result = await this.loadFileFromNamedWACZ(waczname, this.textIndex, {
          unzip: true,
        });
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        return new Response("", { headers });
      }

      const { reader } = result;

      // @ts-expect-error [TODO] - TS2538 - Type 'undefined' cannot be used as an index type.
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
            { unzip: true },
          );
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (reader) {
            readers.push(reader);
          }
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { pageId, noRedirect }: Record<string, any> = {},
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
      // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string | null'.
      waczname = this.waczNameForHash[hash];
      if (!waczname) {
        return null;
      }
      // @ts-expect-error [TODO] - TS2345 - Argument of type '{ waczname: string; }' is not assignable to parameter of type 'Opts'.
      resp = await super.getResource(request, prefix, event, { waczname });
      if (resp) {
        return resp;
      }
    }

    const waczFilesToTry: string[] = await this.getWACZFilesToTry(
      request,
      waczname,
    );

    if (!waczFilesToTry.length) {
      return null;
    }

    const foundMap = new Map();

    for (const name of waczFilesToTry) {
      const file = this.waczfiles[name];
      if (!file) {
        continue;
      }

      if (file.fileType !== WACZ_LEAF) {
        continue;
      }

      // already checked this file above, don't check again
      if (file.hash === hash) {
        continue;
      }

      resp = await super.getResource(request, prefix, event, {
        // @ts-expect-error [TODO] - TS2345 - Argument of type '{ waczname: string; noFuzzyCheck: true; loadFirst: boolean; }' is not assignable to parameter of type 'Opts'.
        waczname: name,
        noFuzzyCheck: true,
        loadFirst: true,
      });
      if (resp) {
        if (noRedirect) {
          return resp;
        }
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
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          ts = getTS(date.toISOString());
          min = dist;
        }
      }

      return Response.redirect(
        `${prefix}:${foundHash}/${ts}mp_/${request.url}`,
      );
    }

    if (this.fuzzyUrlRules.length) {
      for (const { match, replace } of this.fuzzyUrlRules) {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  async queryPages(
    search = "",
    page = 1,
    pageSize = 25,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ pages: Record<string, any>[]; total: number }> {
    const params = new URLSearchParams();
    if (search) {
      params.set("search", search);
    }
    params.set("page", page + "");
    params.set("pageSize", pageSize + "");
    const res = await fetch(this.pagesQueryUrl + "?" + params.toString(), {
      headers: this.sourceLoader?.headers,
    });
    if (res.status !== 200) {
      return { pages: [], total: 0 };
    }
    const json = await res.json();
    if (!json) {
      return { pages: [], total: 0 };
    }

    const total = json.total;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages: Record<string, any>[] = json.items.map((x: any) => {
      x.wacz = x.filename;
      const file = this.waczfiles[x.filename];
      if (file) {
        x.waczhash = file.hash;
      }
      if (typeof x.ts === "string") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        x.ts = new Date(x.ts).getTime();
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return x;
    });

    return { pages, total };
  }

  async getWACZFilesToTry(request: ArchiveRequest, waczname: string | null) {
    let names: string[] = [];

    // always try WACZ files with no pages
    if (this.preloadResources.length) {
      names = [...this.preloadResources];
    }

    let pageUrl;

    // if top-level doc, and has page query, query for which WACZ files should be tried
    if (
      this.pagesQueryUrl &&
      (request.destination === "document" || request.destination === "iframe")
    ) {
      pageUrl = request.url;
      // thumbnail or other custom resource for page, lookup corresponding page url
    } else if (this.pagesQueryUrl && request.url.startsWith("urn:")) {
      const inx = request.url.indexOf("http");
      if (inx > 0) {
        pageUrl = request.url.slice(inx);
      }
    }

    if (pageUrl) {
      const res = await this.getWACZFilesForPagesQuery(pageUrl);
      if (res) {
        names = [...names, ...res];
        return names;
      }
    }

    // if already has a WACZ files, try others from same crawl
    if (waczname) {
      const file = this.waczfiles[waczname];
      if (file?.crawlId) {
        const res = this.seedPageWACZs.get(file.crawlId);
        if (res) {
          names = [...names, ...res.values()];
        }
      }
    }

    // finally if 3 or less WACZ files, just try all of them
    if (!names.length && Object.keys(this.waczfiles).length <= 3) {
      names = Object.keys(this.waczfiles);
    }

    return names;
  }

  async getWACZFilesForPagesQuery(
    requestUrl: string,
  ): Promise<string[] | null> {
    const params = new URLSearchParams();
    const url = new URL(requestUrl);
    url.hash = "";
    params.set("url", url.href);
    params.set("pageSize", "25");
    let res = await fetch(this.pagesQueryUrl + "?" + params.toString(), {
      headers: this.sourceLoader?.headers,
    });
    if (res.status !== 200) {
      return null;
    }
    let json = await res.json();
    if (!json?.items.length && url.search) {
      // remove query string and try again
      url.search = "";
      params.delete("url");
      params.set("search", url.href);
      res = await fetch(this.pagesQueryUrl + "?" + params.toString(), {
        headers: this.sourceLoader?.headers,
      });
      json = await res.json();
    }
    const items: { filename: string; url: string }[] = json.items;
    const selectFiles = [];
    for (const file of items) {
      if (!file.url.startsWith(url.href)) {
        break;
      }
      if (file.filename) {
        selectFiles.push(file.filename);
      }
    }
    if (!selectFiles.length) {
      return null;
    }

    return selectFiles;
  }

  async checkUpdates() {
    if (this.rootSourceType === "json") {
      await this.loadFromJSON();
    }
  }

  async loadFromJSON(response: Response | null = null) {
    if (!response) {
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      const result = await this.sourceLoader.doInitialFetch(false, false);
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain
      response = result && result.response;
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!response || (response.status !== 206 && response.status !== 200)) {
      console.warn("WACZ update failed from: " + this.config.loadUrl);
      return {};
    }

    const data = await response.json();

    if (data.pagesQueryUrl) {
      this.pagesQueryUrl = data.pagesQueryUrl;
    }

    switch (data.profile) {
      case "data-package":
      case "wacz-package":
      //eslint: disable=no-fallthrough
      default:
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        await this.loadWACZFiles(data);
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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
