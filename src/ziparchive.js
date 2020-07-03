import { AsyncIterReader } from 'warcio';
import { RemoteSourceArchiveDB, SingleRecordWARCLoader } from './remotearchivedb';
import { WARCInfoOnlyWARCLoader, WARCLoader } from './warcloader';
import { CDXLoader } from './cdxloader';
import { getTS } from './utils';
import { LiveAccess } from './remoteproxy';

import yaml from 'js-yaml';
import { csv2jsonAsync } from 'json-2-csv';


// ===========================================================================
class ZipRemoteArchiveDB extends RemoteSourceArchiveDB
{
  constructor(name, sourceLoader, extraConfig = null, noCache = false, fullConfig) {
    super(name, sourceLoader, noCache);
    this.zipreader = new ZipRangeReader(sourceLoader);

    this.externalSources = [];
    this.fuzzyUrlRules = [];
    this.useSurt = true;
    this.fullConfig = fullConfig;

    //todo: make this configurable by user?
    sourceLoader.canLoadOnDemand = true;

    if (extraConfig) {
      this.initConfig(extraConfig);
    }
  }

  _initDB(db, oldV, newV, tx) {
    super._initDB(db, oldV, newV, tx);

    if (!oldV) {
      const ziplStore = db.createObjectStore("ziplines", { keyPath: "prefix" });

      const zipFiles = db.createObjectStore("zipEntries", { keyPath: "filename"});
    }
  }

  async init() {
    await super.init();

    await this.loadZipEntries();
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

    this.db.clear("ziplines")
  }

  async loadZiplinesIndex(reader, progressUpdate, totalSize) {
    let currOffset = 0;

    let lastUpdate = 0, updateTime = 0;
    
    for await (const line of reader.iterLines()) {
      currOffset += line.length;

      let entry;

      if (line.indexOf("\t") > 0) {

        let [prefix, filename, offset, length] = line.split("\t");
        offset = Number(offset);
        length = Number(length);

        entry = {prefix, filename, offset, length, loaded: false};

        this.useSurt = true;

      } else {
        const inx = line.indexOf(" {");
        if (inx < 0) {
          console.log("Invalid Index Line: " + line);
          continue;
        }
        const prefix = line.slice(0, inx);
        const {offset, length, filename} = JSON.parse(line.slice(inx));

        entry = {prefix, filename, offset, length, loaded: false};

      }

      updateTime = new Date().getTime();
      if ((updateTime - lastUpdate) > 500) {
        progressUpdate(Math.round((currOffset / totalSize) * 100.0), null, currOffset, totalSize);
        lastUpdate = updateTime;
      }

      await this.db.put("ziplines", entry);
    }
  }

  async load(db, progressUpdate, totalSize) {
    if (db !== this) {
      console.error("wrong db");
      return;
    }

    const entries = await db.zipreader.load(true);

    await db.saveZipEntries(entries);

    const indexloaders = [];
    let metadata;

    if (entries["webarchive.yaml"]) {
      metadata = await this.loadMetadata(entries, await db.zipreader.loadFile("webarchive.yaml"));
    }

    for (const filename of Object.keys(entries)) {
      if (filename.endsWith(".cdx") || filename.endsWith(".cdxj")) {
        // For regular cdx
        console.log("Loading CDX " + filename);

        const reader = await db.zipreader.loadFile(filename);
        indexloaders.push(new CDXLoader(reader).load(db));

      } else if (filename.endsWith(".idx")) {

        // load only if doing on-demand loading, otherwise we load the WARCs fully, ignoring existing indices
        if (this.loader.canLoadOnDemand) {
          // For compressed indices
          console.log("Loading IDX " + filename);

          const entryTotal = db.zipreader.getCompressedSize(filename);

          indexloaders.push(db.loadZiplinesIndex(await db.zipreader.loadFile(filename), progressUpdate, entryTotal));
        }

      } else if (filename.endsWith(".warc.gz") || filename.endsWith(".warc")) {

        // if on-demand loading, and no metadata, load only the warcinfo records to attempt to get metadata
        if (!metadata && this.loader.canLoadOnDemand) {
          // for WR metadata at beginning of WARCS
          const abort = new AbortController();
          const reader = await db.zipreader.loadFile(filename, {signal: abort.signal, unzip: true});
          const warcinfoLoader = new WARCInfoOnlyWARCLoader(reader, abort);
          const entryTotal = db.zipreader.getCompressedSize(filename);
          metadata = await warcinfoLoader.load(db, progressUpdate, entryTotal);
        } else if (!this.loader.canLoadOnDemand) {
          // otherwise, need to load the full WARCs
          const reader = await db.zipreader.loadFile(filename, {unzip: true});
          const warcLoader = new WARCLoader(reader);
          warcLoader.detectPages = false;
          const entryTotal = db.zipreader.getCompressedSize(filename);
          metadata = await warcLoader.load(db, progressUpdate, entryTotal);
        }
      }
    }

    await Promise.all(indexloaders);
    return metadata || {};
  }

  async loadPagesCSV(reader) {
    const csv = new TextDecoder().decode(await reader.readFully());

    const pages = await csv2jsonAsync(csv);

    if (pages && pages.length) {
      await this.addPages(pages);
    }
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
  }

  async loadMetadata(entries, reader) {
    const text = new TextDecoder().decode(await reader.readFully());
    const root = yaml.safeLoad(text);

    if (root.config !== undefined) {
      this.initConfig(root.config);
    }

    const metadata = {desc: root.desc, title: root.title};

    // All pages
    const pages = root.pages || [];

    if (pages && pages.length) {
      await this.addPages(pages);
    } else {
      if (entries["pages.csv"]) {
        await this.loadPagesCSV(await this.zipreader.loadFile("pages.csv"));
      }
    }

    // Curated Pages
    const pageLists = root.pageLists || [];

    if (pageLists && pageLists.length) {
      await this.addCuratedPageLists(pageLists, "pages", "show");
    }

    return metadata;
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

    return await loader.load();
  }

  getSurt(url) {
    try {
      url = url.replace(/www\d*\./, '');
      const urlObj = new URL(url);

      const hostParts = urlObj.hostname.split(".").reverse();
      let surt = hostParts.join(",");
      if (urlObj.port) {
        surt += ":" + urlObj.port;
      }
      surt += ")";
      surt += urlObj.pathname;
      return surt.toLowerCase();
    } catch (e) {
      return url;
    }
  }

  async loadFromZiplines(url, datetime) {
    const timestamp = datetime ? getTS(new Date(datetime).toISOString()) : "";

    let prefix;
    let checkPrefix;

    const surt = this.useSurt ? this.getSurt(url) : url;

    prefix = surt + " " + timestamp;
    checkPrefix = surt;

    const tx = this.db.transaction("ziplines", "readonly");

    const values = [];

    // and first match
    const key = IDBKeyRange.upperBound(prefix, true);

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

      const filename = "indexes/" + zipblock.filename;
      const params = {offset: zipblock.offset, length: zipblock.length, unzip: true}
      const reader = await this.zipreader.loadFile(filename, params);

      cdxloaders.push(new CDXLoader(reader).load(this));

      zipblock.loaded = true;
      await this.db.put("ziplines", zipblock);
    }

    await Promise.all(cdxloaders);

    return cdxloaders.length > 0;
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


// ===========================================================================
const MAX_INT32 = 0xFFFFFFFF;
const MAX_INT16 = 0xFFFF;


// ===========================================================================
class ZipRangeReader
{
  constructor(loader, entries = null) {
    this.loader = loader;
    this.entries = entries;
  }

  async load(always = false) {
    if (!this.entries || always) {
      const totalLength = await this.loader.getLength();
      const length = (MAX_INT16 + 23);
      const start = totalLength - length;
      const endChunk = await this.loader.getRange(start, length);

      this.entries = this._loadEntries(endChunk, start);
    }
    return this.entries;
  }

  _loadEntries(data, dataStartOffset) {
    // Adapted from
    // Copyright (c) 2016 Rob Wu <rob@robwu.nl> (https://robwu.nl)
    //  * Published under a MIT license.
    // * https://github.com/Rob--W/zipinfo.js
    const length = data.byteLength;
    const view = new DataView(data.buffer);

    const utf8Decoder = new TextDecoder("utf8");
    const asciiDecoder = new TextDecoder("ascii");
    const entries = {};

    let entriesLeft = 0;
    let offset = 0;
    let endoffset = length;
    // Find EOCD (0xFFFF is the maximum size of an optional trailing comment).
    for (let i = length - 22, ii = Math.max(0, i - MAX_INT16); i >= ii; --i) {
      if (data[i] === 0x50 && data[i + 1] === 0x4b &&
        data[i + 2] === 0x05 && data[i + 3] === 0x06) {
          endoffset = i;
          offset = view.getUint32(i + 16, true);
          entriesLeft = view.getUint16(i + 8, true);
          break;
        }
    }

    //ZIP64 find offset
    if (offset === MAX_INT32 || entriesLeft === MAX_INT16) {
      if (view.getUint32(endoffset - 20, true) !== 0x07064b50) {
        console.warn('invalid zip64 EOCD locator');
        return;
      }

      const zip64Offset = this.getUint64(view, endoffset - 12, true);

      const viewOffset = zip64Offset - dataStartOffset;

      if (view.getUint32(viewOffset, true) !== 0x06064b50) {
        console.warn('invalid zip64 EOCD record');
        return;
      }

      entriesLeft = this.getUint64(view, viewOffset + 32, true);
      offset = this.getUint64(view, viewOffset + 48, true);
      //zip64 = true;
    }

    if (dataStartOffset) {
      offset -= dataStartOffset;
    }

    if (offset >= length || offset <= 0) {
      // EOCD not found or malformed. Try to recover if possible (the result is
      // most likely going to be incomplete or bogus, but we can try...).
      offset = -1;
      entriesLeft = MAX_INT16;
      while (++offset < length && data[offset] !== 0x50 &&
        data[offset + 1] !== 0x4b && data[offset + 2] !== 0x01 &&
          data[offset + 3] !== 0x02);
    }

    endoffset -= 46;  // 46 = minimum size of an entry in the central directory.

    while (--entriesLeft >= 0 && offset < endoffset) {
      if (view.getUint32(offset) != 0x504b0102) {
        break;
      }

      const bitFlag = view.getUint16(offset + 8, true);
      let compressedSize = view.getUint32(offset + 20, true);
      let uncompressedSize = view.getUint32(offset + 24, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraFieldLength = view.getUint16(offset + 30, true);
      const fileCommentLength = view.getUint16(offset + 32, true);

      const deflate = (view.getUint16(offset + 10, true) === 8);
          
      let localEntryOffset = view.getUint32(offset + 42, true);

      const decoder = (bitFlag & 0x800) ? utf8Decoder : asciiDecoder;
      const filename = decoder.decode(data.subarray(offset + 46, offset + 46 + fileNameLength));

      // ZIP64 support
      if (compressedSize === MAX_INT32 ||
          uncompressedSize === MAX_INT32 ||
          localEntryOffset === MAX_INT32) {

        let extraFieldOffset = offset + 46 + fileNameLength;
        const efEnd = extraFieldOffset + extraFieldLength - 3;
        while (extraFieldOffset < efEnd) {
          const type = view.getUint16(extraFieldOffset, true);
          let size = view.getUint16(extraFieldOffset + 2, true);
          extraFieldOffset += 4;

          // zip64 info
          if (type === 1) {
            if (uncompressedSize === MAX_INT32 && size >= 8) {
              uncompressedSize = this.getUint64(view, extraFieldOffset, true);
              extraFieldOffset += 8;
              size -= 8;
            }
            if (compressedSize === MAX_INT32 && size >= 8) {
              compressedSize = this.getUint64(view, extraFieldOffset, true);
              extraFieldOffset += 8;
              size -= 8;
            }
            if (localEntryOffset === MAX_INT32 && size >= 8) {
              localEntryOffset = this.getUint64(view, extraFieldOffset, true);
              extraFieldOffset += 8;
              size -= 8;
            }
          }

          extraFieldOffset += size
        }
      }

      const directory = filename.endsWith('/');

      if (!directory) {
        entries[filename] = {
          filename,
          deflate,
          uncompressedSize,
          compressedSize,
          localEntryOffset
        };
      }

      offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
    return entries;
  }

  async loadFileCheckDirs(name, offset, length) {
    if (this.entries === null) {
      await this.load();
    }

    if (this.entries["archive/" + name]) {
      name = "archive/" + name;
    } else if (this.entries["warcs/" + name]) {
      name = "warcs/" + name;
    } else {
      for (const filename of Object.keys(this.entries)) {
        if (filename.endsWith("/" + name)) {
          name = filename;
          break;
        }
      }
    }

    return await this.loadFile(name, {offset, length, unzip: true});
  }

  getCompressedSize(name) {
    if (this.entries === null) {
      return -1;
    }

    const entry = this.entries[name];

    if (!entry) {
      return -1;
    }

    return entry.compressedSize;
  }

  async loadFile(name, {offset = 0, length = -1, signal = null, unzip = false} = {}) {
    if (this.entries === null) {
      await this.load();
    }

    const entry = this.entries[name];

    if (!entry) {
      return null;
    }

    if (entry.offset === undefined) {
      const header = await this.loader.getRange(entry.localEntryOffset, 30);
      const view = new DataView(header.buffer);

      const fileNameLength = view.getUint16(26, true);
      const extraFieldLength = view.getUint16(28, true);

      entry.offset = 30 + fileNameLength + extraFieldLength + entry.localEntryOffset;
    }

    length = length < 0 ? entry.compressedSize : Math.min(length, entry.compressedSize - offset);

    offset += entry.offset;

    const body = await this.loader.getRange(offset, length, true, signal);

    // if not unzip, deflate if needed only
    if (!unzip) {
      return new AsyncIterReader(body.getReader(), entry.deflate ? "deflate" : null);
    // if unzip and not deflated, reuse AsyncIterReader for auto unzipping
    } else if (!entry.deflate) {
      return new AsyncIterReader(body.getReader());
    } else {
    // need to deflate, than unzip again
      return new AsyncIterReader(new AsyncIterReader(body.getReader(), "deflate"));
    }
  }

  // from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView
  getUint64(dataview, byteOffset, littleEndian) {
    // split 64-bit number into two 32-bit (4-byte) parts
    const left =  dataview.getUint32(byteOffset, littleEndian);
    const right = dataview.getUint32(byteOffset+4, littleEndian);

    // combine the two 32-bit values
    const combined = littleEndian? left + 2**32*right : 2**32*left + right;

    if (!Number.isSafeInteger(combined))
      console.warn(combined, 'exceeds MAX_SAFE_INTEGER. Precision may be lost');

    return combined;
  }
}


export { ZipRangeReader, ZipRemoteArchiveDB };

