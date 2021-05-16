import { RemoteSourceArchiveDB } from "./remotearchivedb";
import { SingleRecordWARCLoader } from "./warcloader";
import { CDXLoader } from "./cdxloader";
import { LiveAccess } from "./remoteproxy";
import { getSurt } from "warcio";
import { ZipRangeReader } from "./ziprangereader";


// ===========================================================================
export class WACZRemoteArchiveDB extends RemoteSourceArchiveDB
{
  constructor(name, sourceLoader, fullConfig) {
    super(name, sourceLoader, fullConfig.noCache);
    this.zipreader = new ZipRangeReader(sourceLoader);

    this.autoHttpsCheck = false;

    this.externalSources = [];
    this.fuzzyUrlRules = [];
    this.fullConfig = fullConfig;
    this.useSurt = fullConfig && fullConfig.useSurt;
    this.textIndex = fullConfig && fullConfig.metadata && fullConfig.metadata.textIndex;

    if (fullConfig.extraConfig) {
      this.initConfig(fullConfig.extraConfig);
    }

    this.ziploadercache = {};
  }

  _initDB(db, oldV, newV, tx) {
    super._initDB(db, oldV, newV, tx);

    if (!oldV) {
      db.createObjectStore("ziplines", { keyPath: "prefix" });

      db.createObjectStore("zipEntries", { keyPath: "filename"});
    }
  }

  async init() {
    await super.init();

    await this.loadZipEntries();
  }

  async close() {
    super.close();
    caches.delete("cache:" + this.name.slice("db:".length));
  }

  async clearZipData() {
    const stores = ["zipEntries", "ziplines"];

    for (const store of stores) {
      await this.db.clear(store);
    }
  }

  async clearAll() {
    await super.clearAll();

    await this.clearZipData();
  }

  updateHeaders(headers) {
    this.zipreader.loader.headers = headers;
  }

  async loadZipEntries() {
    const entriesList = await this.db.getAll("zipEntries");
    if (!entriesList.length) {
      return;
    }

    const entries = {};
    for (const entry of entriesList) {
      entries[entry.filename] = entry;
    }

    this.zipreader.entries = entries;
  }

  async saveZipEntries(entries) {
    const tx = this.db.transaction("zipEntries", "readwrite");

    tx.store.clear();

    for (const entry of Object.values(entries)) {
      tx.store.put(entry);
    }

    await tx.done;
  }

  initConfig(config) {
    if (config.decodeResponses !== undefined) {
      this.fullConfig.decode = config.decodeResponses;
    }
    if (config.useSurt !== undefined) {
      this.useSurt = config.useSurt;
    }
    if (config.es) {
      for (const [prefix, externalPath] of config.es) {
        const external = new LiveAccess(externalPath, true, false);
        this.externalSources.push({prefix, external});
      }
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

    const size = this.zipreader.getCompressedSize(this.textIndex);

    if (size > 0) {
      headers["Content-Length"] = "" + size;
    }

    const reader = await this.zipreader.loadFile(this.textIndex, {unzip: true});

    return new Response(reader.getReadableStream(), {headers});
  }
  
  async loadRecordFromSource(cdx) {
    let filename;
    let offset = 0;
    let length = -1;

    const source = cdx.source;

    if (typeof(source) === "string") {
      filename = source;
    } else if (typeof(source) === "object") {
      offset = source.start;
      length = source.length;
      filename = source.path;
    } else {
      return null;
    }

    let loader = null;
   
    const fileStream = await this.zipreader.loadFileCheckDirs(filename, offset, length);
    loader = new SingleRecordWARCLoader(fileStream);

    // optimization: save with offset
    if (this.zipreader.entriesUpdated) {
      await this.saveZipEntries(this.zipreader.entries);
      this.zipreader.entriesUpdated = false;
    }

    return await loader.load();
  }

  async loadFromZiplines(url/*, datetime*/) {
    //const timestamp = datetime ? getTS(new Date(datetime).toISOString()) : "";

    let prefix;
    let checkPrefix;

    const surt = this.useSurt ? getSurt(url) : url;

    prefix = surt + " 9999";
    checkPrefix = surt;

    const tx = this.db.transaction("ziplines", "readonly");

    const values = [];

    // and first match
    const key = IDBKeyRange.upperBound(prefix, false);

    for await (const cursor of tx.store.iterate(key, "prev")) {
      // add to beginning as processing entries in reverse here
      values.unshift(cursor.value);
      if (!cursor.value.prefix.split(" ")[0].startsWith(checkPrefix)) {
        break;
      }
    }

    await tx.done;

    const cdxloaders = [];

    for (const zipblock of values) {
      if (zipblock.loaded) {
        continue;
      }

      const cacheKey = zipblock.filename + ":" + zipblock.offset;

      let cachedLoad = this.ziploadercache[cacheKey];

      if (!cachedLoad) {
        cachedLoad = this._doIDXLoad(cacheKey, zipblock);
        this.ziploadercache[cacheKey] = cachedLoad;
      }
      cdxloaders.push(cachedLoad);
    }

    if (cdxloaders.length) {
      await Promise.allSettled(cdxloaders);
    }

    return cdxloaders.length > 0;
  }

  async _doIDXLoad(cacheKey, zipblock) {
    try {
      const filename = "indexes/" + zipblock.filename;
      const params = {offset: zipblock.offset, length: zipblock.length, unzip: true};
      const reader = await this.zipreader.loadFile(filename, params);

      const loader = new CDXLoader(reader);
      await loader.load(this);

      zipblock.loaded = true;
      await this.db.put("ziplines", zipblock);

    } catch (e) {
      console.warn(e);
    } finally {
      delete this.ziploadercache[cacheKey];
    }
  }

  async addZipLines(batch) {
    const tx = this.db.transaction("ziplines", "readwrite");

    for (const entry of batch) {
      tx.store.put(entry);
    }

    try {
      await tx.done;
    } catch (e) {
      console.log("Error loading ziplines index: ", e);
    }
  }

  async getResource(request, rwPrefix, event) {
    if (this.externalSources.length) {
      for (const {prefix, external} of this.externalSources) {
        if (request.url.startsWith(prefix)) {
          try {
            return await external.getResource(request, rwPrefix, event);
          } catch(e) {
            console.warn("Upstream Error", e);
            //return new Response("Upstream Error", {status: 503});
          }
        }
      }
    }

    let res = await super.getResource(request, rwPrefix, event);

    if (res) {
      return res;
    }

    if (this.fuzzyUrlRules.length) {
      for (const {match, replace} of this.fuzzyUrlRules) {
        const newUrl = request.url.replace(match, replace);
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

  async lookupUrl(url, datetime, opts = {}) {
    try {
      let result = await super.lookupUrl(url, datetime, opts);

      if (result && (!opts.noRevisits || result.mime !== "warc/revisit")) {
        return result;
      }

      if (await this.loadFromZiplines(url, datetime)) {
        result = await super.lookupUrl(url, datetime, opts);
      }

      return result;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  async resourcesByUrlAndMime(url, ...args) {
    let results = await super.resourcesByUrlAndMime(url, ...args);

    if (results.length > 0) {
      return results;
    }

    if (await this.loadFromZiplines(url, "")) {
      results = await super.resourcesByUrlAndMime(url, ...args);
    }

    return results;
  }
}
