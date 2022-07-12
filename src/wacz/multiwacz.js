
import { ZipRangeReader } from "./ziprangereader";
import { OnDemandPayloadArchiveDB } from "../remotearchivedb";
import { SingleRecordWARCLoader } from "../warcloader";
import { CDXLoader } from "../cdxloader";
import { digestMessage, handleAuthNeeded, tsToDate } from "../utils";
import { getSurt } from "warcio";
import { createLoader } from "../blockloaders";
import { LiveProxy } from "../liveproxy";
import { JSONMultiWACZLoader, loadPages } from "./waczloader";


const INDEX_NOT_LOADED = 0;
const INDEX_CDX = 1;
const INDEX_IDX = 2;
//const INDEX_FULL = 3;

const MAX_BLOCKS = 3;


// ==========================================================================
export class WACZArchiveDB extends OnDemandPayloadArchiveDB
{
  constructor(config, noCache = false) {
    super(config.dbname, noCache);
    this.config = config;

    this.waczfiles = {};
    this.waczhashes = {};
    this.ziploadercache = {};
  }

  _initDB(db, oldV, newV, tx) {
    super._initDB(db, oldV, newV, tx);

    if (!oldV) {
      db.createObjectStore("ziplines", { keyPath: ["waczname", "prefix"] });

      db.createObjectStore("waczfiles", { keyPath: "waczname"} );
    }
  }

  async init() {
    await super.init();

    const fileDatas = await this.db.getAll("waczfiles") || [];

    for (const file of fileDatas) {
      this.waczfiles[file.waczname] = file;
    }

    await this.initLoader();
  }

  initLoader() {
    
  }

  getReaderForWACZ() {
    throw new Error("Unimplemented here");
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

  async clearAll() {
    await super.clearAll();

    await this.clearZipData();
  }


  async addWACZFile(waczname, entries) {
    const filedata = {waczname, entries, indexType: INDEX_NOT_LOADED};

    await this.db.put("waczfiles", filedata);

    this.waczfiles[waczname] = filedata;

    const digest = await this.getWACZHash(waczname);

    this.waczhashes[digest] = waczname;
  }

  async getWACZHash(waczname) {
    return await digestMessage(waczname, "sha-256", "");
  }

  async computeWACZHashes() {
    for (const waczname of Object.keys(this.waczfiles)) {
      const digest = await this.getWACZHash(waczname);

      this.waczhashes[digest] = waczname;
    }
  }

  async loadRecordFromSource(cdx) {
    const {start, length, path} = cdx.source;
    const wacz = this.getWACZName(cdx);
    const offset = start;
    const unzip = true;

    const zipreader = await this.getReaderForWACZ(wacz);

    const fileStream = await zipreader.loadFile("archive/" + path, {offset, length, unzip});
    const loader = new SingleRecordWARCLoader(fileStream);

    await this.updateEntriesIfNeeded(zipreader, wacz);

    return await loader.load();
  }

  async loadWACZ(waczname) {
    if (!this.waczfiles[waczname]) {
      throw new Error("unknown waczfile: " + waczname);
    }

    if (this.waczfiles[waczname].indexType) {
      return {indexType: this.waczfiles[waczname].indexType, isNew: false};
    }

    const zipreader = await this.getReaderForWACZ(waczname);
    await zipreader.load();

    //const indexloaders = [];
    let indexType = INDEX_NOT_LOADED;

    // load CDX and IDX
    for (const filename of Object.keys(this.waczfiles[waczname].entries)) {
      if (filename.endsWith(".cdx") || filename.endsWith(".cdxj")) {

        console.log(`Loading CDX for ${waczname}`);

        await this.loadCDX(zipreader, filename, waczname);

        indexType = INDEX_CDX;

      } else if (filename.endsWith(".idx")) {
        // For compressed indices
        console.log(`Loading IDX for ${waczname}`);

        await this.loadIDX(zipreader, filename, waczname);

        indexType = INDEX_IDX;
      }
    }

    this.waczfiles[waczname].indexType = indexType;

    await this.db.put("waczfiles", this.waczfiles[waczname]);

    return {indexType, isNew: true};
  }

  async loadCDX(zipreader, filename, waczname, progressUpdate, total) {
    const reader = await zipreader.loadFile(filename);

    const loader = new CDXLoader(reader, null, waczname, {wacz: waczname});

    return await loader.load(this, progressUpdate, total);
  }

  async loadIDX(zipreader, filename, waczname, progressUpdate, total) {
    const reader = await zipreader.loadFile(filename);

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
        let {offset, length, filename} = JSON.parse(line.slice(inx));

        useSurt = prefix.indexOf(")/") > 0;

        filename = filename || defaultFilename;

        entry = {waczname, prefix, filename, offset, length, loaded: false};
      }

      if (progressUpdate) {
        progressUpdate(currOffset / total, currOffset, total);
      }

      batch.push(entry);
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
      await this.db.put("waczfiles", this.waczfiles[waczname]);
    }
  }

  async loadCDXFromIDX(waczname, url, datetime = 0, isPrefix = false) {
    //const timestamp = datetime ? getTS(new Date(datetime).toISOString()) : "";

    const surt = this.waczfiles[waczname].useSurt ? getSurt(url) : url;

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

    const zipreader = await this.getReaderForWACZ(waczname);

    const waczSource = {
      wacz: waczname
    };

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
        cachedLoad = this.doCDXLoad(cacheKey, zipblock, zipreader, waczSource);
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

    await this.updateEntriesIfNeeded(zipreader, waczname);

    return cdxloaders.length > 0;
  }

  async doCDXLoad(cacheKey, zipblock, zipreader, waczSource) {
    try {
      const filename = "indexes/" + zipblock.filename;
      const params = {offset: zipblock.offset, length: zipblock.length, unzip: true};
      const reader = await zipreader.loadFile(filename, params);

      const loader = new CDXLoader(reader, null, null, waczSource);
      await loader.load(this);

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

  async updateEntriesIfNeeded(zipreader, waczname) {
    if (zipreader.entriesUpdated) {
      await this.db.put("waczfiles", this.waczfiles[waczname]);
      zipreader.entriesUpdated = false;
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

      if (waczname && waczname !== "local") {
        result = await this.lookupUrlForWACZ(waczname, url, datetime, opts);
      }

      return result;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  async lookupUrlForWACZ(waczname, url, datetime, opts) {
    const {indexType, isNew} = await this.loadWACZ(waczname);

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
        const {indexType, isNew} = await this.loadWACZ(waczname);
        
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
}


// ==========================================================================
export class MultiWACZCollection extends WACZArchiveDB
{
  async initLoader() {
    const config = this.config;

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

  async checkUpdates() {
    const {response} = await this.indexLoader.doInitialFetch(false);
    if (response.status !== 206 && response.status !== 200) {
      console.warn("WACZ update failed from: " + this.config.loadUrl);
      return;
    }
    const loader = new JSONMultiWACZLoader(await response.json(), this.config.loadUrl);
    const files = loader.loadFiles();
    await this.syncWACZ(files);
  }

  async syncWACZ(files) {
    const promises = [];

    for (const waczname of files) {
      if (!this.waczfiles[waczname]) {
        promises.push(this.loadNewWACZ(waczname));
      }
    }

    if (promises.length) {
      await Promise.allSettled(promises);
    }
  }

  async loadNewWACZ(waczname) {
    const loader = await this.getBlockLoader(waczname);

    const zipreader = new ZipRangeReader(loader);

    const entries = await zipreader.load(true);

    await this.addWACZFile(waczname, entries);

    await loadPages(this, zipreader, waczname);

    await this.updateEntriesIfNeeded(zipreader, waczname);
  }

  async getResource(request, prefix, event, {pageId} = {}) {
    await this.initing;

    const isNavigate = event.request.mode === "navigate";

    let waczhash = pageId;
    let waczname = null;

    let resp = null;

    if (waczhash) {
      if (!Object.keys(this.waczhashes).length) {
        await this.computeWACZHashes();
      }
      waczname = this.waczhashes[waczhash];
      if (!waczname) {
        return null;
      }
      resp = await super.getResource(request, prefix, event, {waczname});
    }

    if (resp || !isNavigate) {
      return resp;
    }

    for (const checkWaczname of Object.keys(this.waczfiles)) {
      resp = await super.getResource(request, prefix, event, {waczname: checkWaczname, noFuzzyCheck: true});
      if (resp) {
        waczname = checkWaczname;
        waczhash = await this.getWACZHash(waczname);
        break;
      }
    }

    if (!waczname) {
      return;
    }
    
    return Response.redirect(`${prefix}:${waczhash}/${request.timestamp}mp_/${request.url}`);

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

  async getReaderForWACZ(waczname) {
    return new ZipRangeReader(
      await this.getBlockLoader(waczname),
      this.waczfiles[waczname].entries
    );
  }

  getBlockLoader(filename) {
    return createLoader({
      url: filename
    });
  }
}


// ==========================================================================
export class SingleWACZ extends WACZArchiveDB
{
  constructor(fullConfig, sourceLoader) {
    super(fullConfig, fullConfig.noCache);

    this.zipreader = new ZipRangeReader(sourceLoader);

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
  }

  async convertV2WACZDB(db, tx) {
    try {

      const ziplines = await (tx.objectStore("ziplines")).getAll();
      const entries = await (tx.objectStore("zipEntries")).getAll();

      db.deleteObjectStore("ziplines");

      db.deleteObjectStore("zipEntries");

      db.createObjectStore("ziplines", { keyPath: ["waczname", "prefix"] });

      db.createObjectStore("waczfiles", { keyPath: "waczname"} );

      const waczname = this.getWACZName();

      for (const line of ziplines) {
        line.waczname = waczname;
        tx.objectStore("ziplines").put(line);
      }

      const indexType = ziplines.length > 0 ? INDEX_IDX : INDEX_CDX;
      const filedata = {waczname, entries, indexType};

      tx.objectStore("waczfiles").put(filedata);

      await tx.done;
    } catch (e)  {
      console.warn(e);
    }
  }

  getReaderForWACZ() {
    return this.zipreader;
  }

  updateHeaders(headers) {
    this.zipreader.loader.headers = headers;
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

  async getTextIndex() {
    const headers = {"Content-Type": "application/ndjson"};

    if (!this.textIndex) {
      return new Response("", {headers});
    }

    try {
      await this.zipreader.load();
    } catch (e) {
      await handleAuthNeeded(e, this.config);
      return new Response("", {headers});
    }

    const size = this.zipreader.getCompressedSize(this.textIndex);

    if (size > 0) {
      headers["Content-Length"] = "" + size;
    }

    const reader = await this.zipreader.loadFile(this.textIndex, {unzip: true});

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

    const waczname = this.getWACZName();

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

  getWACZName() {
    return this.config.loadUrl;
  }
}
