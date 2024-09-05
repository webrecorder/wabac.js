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
// @ts-expect-error [TODO] - TS2459 - Module '"../archivedb"' declares 'DBType' locally, but it is not exported.
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

  constructor(
    config: Config,
    sourceLoader: BaseLoader,
    rootSourceType: "wacz" | "json" = "wacz",
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

      // @ts-expect-error [TODO] - TS2339 - Property 'loadUrl' does not exist on type 'Config'.
      const waczname = this.config.loadUrl;

      for (const line of ziplines) {
        line.waczname = waczname;
        tx.objectStore("ziplines").put(line);
      }

      const indexType = ziplines.length > 0 ? INDEX_IDX : INDEX_CDX;
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cdx: Record<string, any>,
  ): LoadRecordFromSourceType {
    // @ts-expect-error [TODO] - TS4111 - Property 'source' comes from an index signature, so it must be accessed with ['source'].
    const { start, length, path, wacz } = cdx.source;
    const params = { offset: start, length, unzip: true, computeHash: true };
    const waczname = wacz;

    const { reader, hasher } = await this.loadFileFromNamedWACZ(
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
    parent,
    loader = null,
  }: WACZFileInitOptions & { name: string }) {
    const waczname = name || path || "";

    hash = await this.computeFileHash(waczname, hash);

    const file = this.addWACZFile({ waczname, hash, path, parent, loader });

    // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
    await file.init();

    // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
    await file.save(this.db, true);

    // @ts-expect-error [TODO] - TS2345 - Argument of type 'WACZFile | undefined' is not assignable to parameter of type 'WACZFile'.
    const importer = new WACZImporter(this, file, !parent);

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await importer.load();
  }

  async loadWACZFiles(
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: Record<string, any>,
    parent: WACZLoadSource = this,
  ) {
    const promises: Promise<void>[] = [];

    const update = async (name: string, path: string) => {
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      await this.waczfiles[name].init(path);
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      await this.waczfiles[name].save(this.db, true);
    };

    // @ts-expect-error [TODO] - TS4111 - Property 'resources' comes from an index signature, so it must be accessed with ['resources'].
    const files = json.resources.map(
      (res: { path: string; name: string; hash: string }) => {
        const path = parent.getLoadPath(res.path);
        const name = parent.getName(res.name);
        const hash = res.hash;
        return { name, hash, path };
      },
    );

    for (const { name, hash, path } of files) {
      if (!this.waczfiles[name]) {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        promises.push(this.addNewWACZ({ name, hash, path, parent }));
      } else if (this.waczfiles[name].path !== path) {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
    { pageId }: Record<string, any> = {},
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
        // @ts-expect-error [TODO] - TS2345 - Argument of type '{ waczname: string; noFuzzyCheck: true; loadFirst: boolean; }' is not assignable to parameter of type 'Opts'.
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
      // @ts-expect-error [TODO] - TS2339 - Property 'loadUrl' does not exist on type 'Config'.
      console.warn("WACZ update failed from: " + this.config.loadUrl);
      return {};
    }

    const data = await response.json();

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
    // @ts-expect-error [TODO] - TS2339 - Property 'loadUrl' does not exist on type 'Config'.
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return new URL(path, this.config.loadUrl).href;
  }

  getName(name: string) {
    return name;
  }

  async createLoader(opts: BlockLoaderOpts): Promise<BaseLoader> {
    return await createLoader(opts);
  }
}
