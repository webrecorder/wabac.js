import { OnDemandPayloadArchiveDB } from "../remotearchivedb.js";
import { SingleRecordWARCLoader } from "../warcloader.js";
import { CDXLoader, CDX_COOKIE } from "../cdxloader.js";
import { AccessDeniedError, digestMessage, handleAuthNeeded, tsToDate } from "../utils.js";
import { getSurt } from "warcio";
import { createLoader } from "../blockloaders.js";
import { LiveProxy } from "../liveproxy.js";

import { DEFAULT_WACZ, INDEX_CDX, INDEX_IDX, INDEX_NOT_LOADED, NO_LOAD_WACZ, WACZFile } from "./waczfile.js";
import { WACZImporter } from "./waczimporter.js";

const MAX_BLOCKS = 3;

const IS_SURT = /^([\w-]+,)*[\w-]+(:\d+)?,?\)\//;


// ==========================================================================
export class WACZArchiveDB extends OnDemandPayloadArchiveDB
{
  constructor(config, noCache = false) {
    super(config.dbname, noCache);
    this.config = config;

    this.waczfiles = {};
    this.waczNameForHash = {};
    this.ziploadercache = {};
  }

  _initDB(db, oldV, newV, tx) {
    super._initDB(db, oldV, newV, tx);

    if (!oldV) {
      db.createObjectStore("ziplines", { keyPath: ["waczname", "prefix"] });

      db.createObjectStore("waczfiles", { keyPath: "waczname"} );

      db.createObjectStore("verification",  {keyPath: "id" });
    }
  }

  addWACZFile(file) {
    this.waczfiles[file.waczname] = new WACZFile(file);
    this.waczNameForHash[file.hash] = file.waczname;
    return this.waczfiles[file.waczname];
  }

  async init() {
    await super.init();

    const fileDatas = await this.db.getAll("waczfiles") || [];

    for (const file of fileDatas) {
      this.addWACZFile(file);
    }

    await this.initLoader();
  }

  initLoader() {
    
  }

  async retryLoad() {
    return false;
  }

  getWACZName(/*cdx*/) {
    throw new Error("Unimplemented here");
  }

  async close() {
    super.close();
    caches.delete("cache:" + this.name.slice("db:".length));
  }

  async clearZipData() {
    const stores = ["waczfiles", "ziplines"];

    for (const store of stores) {
      await this.db.clear(store);
    }
  }

  async addVerifyData(prefix = "", id, expected, actual, log = false) {
    let matched = null;

    if (prefix) {
      id = prefix + id;
    }

    if (actual) {
      matched = expected === actual;
      if (log) {
        console.log(`verify ${id}: ${matched}`);
      }
    }
    await this.db.put("verification", {id, expected, matched});
  }

  async addVerifyDataList(prefix, datalist) {
    const tx = this.db.transaction("verification", "readwrite");

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

  async getVerifyInfo() {
    const results =  await this.db.getAll("verification");

    let numValid = 0;
    let numInvalid = 0;

    let info = {};

    const includeProps = ["domain", "created", "certFingerprint", "software", "datapackageHash", "publicKey"];

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

  async getVerifyExpected(id) {
    const res = await this.db.get("verification", id);
    return res && res.expected;
  }

  async clearAll() {
    await super.clearAll();

    await this.clearZipData();
  }

  async loadRecordFromSource(cdx) {
    const {start, length, path} = cdx.source;
    const params = {offset: start, length, unzip: true, computeHash: true};
    const waczname = this.getWACZName(cdx);

    const {reader, hasher} = await this.loadFileFromNamedWACZ(waczname, "archive/" + path, params);
    
    const loader = new SingleRecordWARCLoader(reader, hasher);

    await this.waczfiles[waczname].save(this.db);

    const remote = await loader.load();

    if (cdx[CDX_COOKIE]) {
      remote.respHeaders["x-wabac-preset-cookie"] = cdx[CDX_COOKIE];
    }

    return {remote, hasher};
  }

  async loadIndex(waczname) {
    if (!this.waczfiles[waczname]) {
      throw new Error("unknown waczfile: " + waczname);
    }

    if (this.waczfiles[waczname].indexType) {
      return {indexType: this.waczfiles[waczname].indexType, isNew: false};
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

    this.waczfiles[waczname].indexType = indexType;

    await this.waczfiles[waczname].save(this.db, true);

    return {indexType, isNew: true};
  }

  async loadCDX(filename, waczname, progressUpdate, total) {
    const { reader, hasher } = await this.loadFileFromNamedWACZ(waczname, filename, {computeHash: true});

    const loader = new CDXLoader(reader, null, waczname, {wacz: waczname});

    const res = await loader.load(this, progressUpdate, total);

    if (hasher) {
      const expected = await this.getVerifyExpected(filename);
      if (expected) {
        this.addVerifyData(waczname, filename, expected, hasher.getHash());
      }
    }

    return res;
  }

  async loadIDX(filename, waczname, progressUpdate, total) {
    const { reader, hasher } = await this.loadFileFromNamedWACZ(waczname, filename, {computeHash: true});

    let batch = [];
    let defaultFilename = "";
    let useSurt = false;

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
            console.log(`Unknown CDXJ format "${indexMetadata.format}", archive may not parse correctly`);
          }
          continue;
        }
      }

      let entry;

      if (line.indexOf("\t") > 0) {
        let [prefix, filename, offset, length] = line.split("\t");
        offset = Number(offset);
        length = Number(length);

        entry = {waczname, prefix, filename, offset, length, loaded: false};

        useSurt = true;
      } else {
        const inx = line.indexOf(" {");
        if (inx < 0) {
          console.log("Invalid Index Line: " + line);
          continue;
        }

        const prefix = line.slice(0, inx);
        let {offset, length, filename, digest} = JSON.parse(line.slice(inx));

        useSurt = useSurt || prefix.match(IS_SURT);

        filename = filename || defaultFilename;

        entry = {waczname, prefix, filename, offset, length, digest, loaded: false};
      }

      if (progressUpdate) {
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

    const tx = this.db.transaction("ziplines", "readwrite");

    for (const entry of batch) {
      tx.store.put(entry);
    }

    try {
      await tx.done;
    } catch (e) {
      console.log("Error loading ziplines index: ", e);
    }

    if (useSurt && useSurt !== this.waczfiles[waczname].useSurt) {
      // only store if defaults to true, false is default
      this.waczfiles[waczname].useSurt = useSurt;
      await this.waczfiles[waczname].save(this.db, true);
    }
  }

  async loadCDXFromIDX(waczname, url, datetime = 0, isPrefix = false) {
    //const timestamp = datetime ? getTS(new Date(datetime).toISOString()) : "";

    const surt = this.waczfiles[waczname].useSurt ? decodeURIComponent(getSurt(url)) : url;

    const upperBound = isPrefix ? this.prefixUpperBound(surt) : surt + " 9999";

    const key = IDBKeyRange.upperBound([waczname, upperBound], true);

    const tx = this.db.transaction("ziplines", "readonly");

    const values = [];

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

    const cdxloaders = [];

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

      const cacheKey = waczname + ":" + zipblock.filename + ":" + zipblock.offset;

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

  async doCDXLoad(cacheKey, zipblock, waczname) {
    try {
      const filename = "indexes/" + zipblock.filename;
      const params = {offset: zipblock.offset, length: zipblock.length, unzip: true, computeHash: !!zipblock.digest};
      const { reader, hasher } = await this.loadFileFromNamedWACZ(waczname, filename, params);

      const loader = new CDXLoader(reader, null, null, {wacz: waczname});
      await loader.load(this);

      if (hasher) {
        const hash = hasher.getHash();
        const id = `${filename}:${zipblock.offset}-${zipblock.length}`;
        await this.addVerifyData(waczname, id, zipblock.digest, hash);
      }

      zipblock.loaded = true;
      await this.db.put("ziplines", zipblock);

    } catch (e) {
      if (!await handleAuthNeeded(e, this.config)) {
        console.warn(e);
      }
    } finally {
      delete this.ziploadercache[cacheKey];
    }
  }

  async findPageAtUrl(url, ts) {
    const pages = await this.db.getAllFromIndex("pages", "url", url);
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

  async lookupUrl(url, datetime, opts = {}) {
    try {
      let result = await super.lookupUrl(url, datetime, opts);

      if (result && (!opts.noRevisits || result.mime !== "warc/revisit")) {
        return result;
      }

      const { waczname } = opts;

      if (waczname && waczname !== NO_LOAD_WACZ) {
        result = await this.lookupUrlForWACZ(waczname, url, datetime, opts);
      }

      return result;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  async lookupUrlForWACZ(waczname, url, datetime, opts) {
    const {indexType, isNew} = await this.loadIndex(waczname);

    switch (indexType) {
    case INDEX_IDX:
      if (!await this.loadCDXFromIDX(waczname, url, datetime, false)) {
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

  async resourcesByUrlAndMime(url, ...args) {
    let results = await super.resourcesByUrlAndMime(url, ...args);

    if (results.length > 0) {
      return results;
    }

    for (const waczname of Object.keys(this.waczfiles)) {
      if (waczname && waczname !== "local") {
        const {indexType, isNew} = await this.loadIndex(waczname);
        
        switch (indexType) {
        case INDEX_IDX:
          if (!await this.loadCDXFromIDX(waczname, url, 0, true)) {
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

  async loadFileFromWACZ(waczfile, filename, opts) {
    if (!waczfile.zipreader) {
      await waczfile.init();
    }

    try {
      return await waczfile.zipreader.loadFile(filename, opts);
    } catch (e) {
      if (await this.retryLoad(e)) {
        return await waczfile.zipreader.loadFile(filename, opts);
      } else {
        throw e;
      }
    }
  }

  async loadFileFromNamedWACZ(waczname, filename, opts) {
    const waczfile = this.waczfiles[waczname];

    if (!waczfile) {
      throw new Error("No WACZ Found for: " + waczname);
    }

    return await this.loadFileFromWACZ(waczfile, filename, opts);
  }

  async addNewWACZ({name, hash, url} = {}) {
    const waczname = name || DEFAULT_WACZ;
    
    if (!hash) {
      hash = await digestMessage(waczname, "sha-256", "");
    }

    const file = this.addWACZFile({waczname, hash, url}, true);

    await file.init();

    await file.save(this.db, true);

    const importer = new WACZImporter(this, file);

    return await importer.load();
  }
}

// ==========================================================================
export class MultiWACZ extends WACZArchiveDB
{
  async initLoader() {
    const config = this.config;
    this.updating = null;

    this.indexLoader = await createLoader({
      url: config.loadUrl,
      headers: config.headers,
      size: config.size,
      extra: config.extra
    });

    await this.checkUpdates();
  }

  getWACZName(cdx) {
    return cdx.source.wacz;
  }

  getSigPrefix(waczname) {
    return waczname + ":";
  }

  async retryLoad(e) {
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
    const {response} = await this.indexLoader.doInitialFetch(false);

    if (response.status !== 206 && response.status !== 200) {
      console.warn("WACZ update failed from: " + this.config.loadUrl);
      return;
    }

    await this.loadWACZFiles(await response.json());
  }

  async loadWACZFiles(json) {
    const files = json.resources.map((res) => {
      const url = new URL(res.path, this.config.loadUrl).href;
      const hash = res.hash;
      const name = res.name;
      return {name, hash, url};
    });

    const promises = [];

    const update = async (name, url) => {
      await this.waczfiles[name].init(url);
      await this.waczfiles[name].save(this.db, true);
    };

    for (const {name, hash, url} of files) {
      if (!this.waczfiles[name]) {
        promises.push(this.addNewWACZ({name, hash, url}));
      } else if (this.waczfiles[name].url !== url) {
        promises.push(update(name, url));
      }
    }

    if (promises.length) {
      await Promise.allSettled(promises);
    }
  }
  
  async getResource(request, prefix, event, {pageId} = {}) {
    await this.initing;

    const isNavigate = event.request.mode === "navigate";

    let hash = pageId;
    let waczname = null;

    let resp = null;

    if (hash) {
      waczname = this.waczNameForHash[hash];
      if (!waczname) {
        return null;
      }
      resp = await super.getResource(request, prefix, event, {waczname});
    }

    if (resp || !isNavigate) {
      return resp;
    }

    for (const name of Object.keys(this.waczfiles)) {
      resp = await super.getResource(request, prefix, event, {waczname: name, noFuzzyCheck: true});
      if (resp) {
        waczname = name;
        hash = this.waczfiles[name].hash;
        break;
      }
    }

    if (!waczname) {
      return;
    }
    
    return Response.redirect(`${prefix}:${hash}/${request.timestamp}mp_/${request.url}`);

    // let waczname;

    // if (pageId) {
    //   const page = await this.db.get("pages", pageId);
    //   if (page) {
    //     waczname = page.wacz;
    //   }
    // }

    // // if waczname, attempt to load from specific wacz
    // const resp = await super.getResource(request, prefix, event, {pageId, waczname});
    // if (resp) {
    //   return resp;
    // }

    // // if navigate, attempt to try to match by page
    // if (isNavigate) {
    //   const ts = tsToDate(request.timestamp).getTime();
    //   const url = request.url;
    //   const page = await this.findPageAtUrl(url, ts);

    //   // redirect to page (if different from current)
    //   if (page && page.id !== pageId) {
    //     return Response.redirect(`${prefix}:${page.id}/${request.timestamp}mp_/${request.url}`);
    //   }
    // }

    // return resp;
  }
}

// ==========================================================================
export class SingleWACZ extends WACZArchiveDB
{
  constructor(fullConfig, sourceLoader) {
    super(fullConfig, fullConfig.noCache);

    this.sourceLoader = sourceLoader;

    this.externalSource = null;
    this.fuzzyUrlRules = [];
    this.useSurt = false;
    this.fullConfig = fullConfig;
    this.textIndex = fullConfig && fullConfig.metadata && fullConfig.metadata.textIndex;

    if (fullConfig.extraConfig) {
      this.initConfig(fullConfig.extraConfig);
    }
  }

  _initDB(db, oldV, newV, tx) {
    super._initDB(db, oldV, newV, tx);

    if (oldV === 2) {
      this.convertV2WACZDB(db, tx);
    }

    if (oldV === 3) {
      db.createObjectStore("verification", {keyPath: "id"});
    }
  }

  async convertV2WACZDB(db, tx) {
    try {

      const ziplines = await (tx.objectStore("ziplines")).getAll();
      const entries = await (tx.objectStore("zipEntries")).getAll();

      db.deleteObjectStore("ziplines");

      db.deleteObjectStore("zipEntries");

      db.createObjectStore("ziplines", { keyPath: ["waczname", "prefix"] });

      db.createObjectStore("waczfiles", { keyPath: "waczname"} );

      db.createObjectStore("verification", {keyPath: "id"});

      const waczname = DEFAULT_WACZ;

      for (const line of ziplines) {
        line.waczname = waczname;
        tx.objectStore("ziplines").put(line);
      }

      const indexType = ziplines.length > 0 ? INDEX_IDX : INDEX_CDX;
      const hash = await this.computeHash(waczname);
      const filedata = new WACZFile({waczname, hash, url: waczname, entries, indexType});

      tx.objectStore("waczfiles").put(filedata.serialize());

      await tx.done;
    } catch (e)  {
      console.warn(e);
    }
  }

  updateHeaders(headers) {
    this.sourceLoader.headers = headers;
  }

  initConfig(config) {
    if (config.decodeResponses !== undefined) {
      this.fullConfig.decode = config.decodeResponses;
    }
    if (config.useSurt !== undefined) {
      this.useSurt = config.useSurt;
    }
    if (config.hostProxy) {
      this.externalSource = new LiveProxy(config, {hostProxyOnly: true});
    }
    if (config.fuzzy) {
      for (const [matchStr, replace] of config.fuzzy) {
        const match = new RegExp(matchStr);
        this.fuzzyUrlRules.push({match, replace});
      }
    }
    if (config.textIndex) {
      this.textIndex = config.textIndex;
    }
  }

  getSigPrefix() {
    return "";
  }

  getWACZName(/*cdx/*/) {
    return DEFAULT_WACZ;
  }

  addWACZFile(file) {
    return super.addWACZFile({...file, loader: this.sourceLoader});
  }

  async getTextIndex() {
    const headers = {"Content-Type": "application/ndjson"};

    if (!this.textIndex) {
      return new Response("", {headers});
    }

    let result;

    try {
      result = await this.loadFileFromNamedWACZ(DEFAULT_WACZ, this.textIndex, {unzip: true});
    } catch (e) {
      return new Response("", {headers});
    }

    const {reader} = result;

    const size = this.waczfiles[DEFAULT_WACZ].getSizeOf(this.textIndex);

    if (size > 0) {
      headers["Content-Length"] = "" + size;
    }

    return new Response(reader.getReadableStream(), {headers});
  }

  async getResource(request, rwPrefix, event, {pageId} = {}) {
    let res = null;

    if (this.externalSource) {
      res = await this.externalSource.getResource(request, rwPrefix, event);
      if (res) {
        return res;
      }
    }

    const waczname = DEFAULT_WACZ;

    res = await super.getResource(request, rwPrefix, event, {pageId, waczname});

    if (res) {
      return res;
    }

    if (this.fuzzyUrlRules.length) {
      for (const {match, replace} of this.fuzzyUrlRules) {
        const newUrl = decodeURIComponent(request.url.replace(match, replace));
        if (newUrl && newUrl !== request.url) {
          request.url = newUrl;
          res = await super.getResource(request, rwPrefix, event);
          if (res) {
            return res;
          }
        }
      }
    }

    return null;
  }
}