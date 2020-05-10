import { AsyncIterReader } from 'warcio';
import { RemoteArchiveDB } from './remotearchivedb';
import { WARCInfoOnlyWARCLoader } from './warcloader';
import { CDXLoader } from './cdxloader';
import { getTS } from './utils';

import yaml from 'js-yaml';


// ===========================================================================
class ZipRemoteArchiveDB extends RemoteArchiveDB
{
  constructor(name, sourceLoader) {
    super(name, sourceLoader);
    this.zipreader = new ZipRangeReader(sourceLoader);
  }

  _initDB(db, oldV, newV, tx) {
    super._initDB(db, oldV, newV, tx);

    const ziplStore = db.createObjectStore("ziplines", { keyPath: "prefix" });

    const zipFiles = db.createObjectStore("zipEntries", { keyPath: "filename"});
  }

  async init() {
    await super.init();

    await this.loadZipEntries();
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

    for (const entry of Object.values(entries)) {
      tx.store.put(entry);
    }

    await tx.done;
  }

  async loadZipIndex(reader) {
    for await (const line of reader.iterLines()) {
      let [prefix, filename, offset, length] = line.split('\t');
      offset = Number(offset);
      length = Number(length);

      await this.db.put("ziplines", {prefix, filename, offset, length, loaded: false});
    }
  }

  async load(db, progressUpdate, totalSize) {
    if (db !== this) {
      console.error("wrong db");
      return;
    }

    const entries = await db.zipreader.load();

    await db.saveZipEntries(entries);

    const indexloaders = [];
    let metadata;

    if (entries["metadata.yaml"]) {
      metadata = await this.loadMetadata(await db.zipreader.loadFile("metadata.yaml"));
    }

    for (const filename of Object.keys(entries)) {
      if (filename.endsWith(".cdx") || filename.endsWith(".cdxj")) {
        // For regular cdx
        console.log("Loading CDX " + filename);

        const reader = await db.zipreader.loadFile(filename);
        indexloaders.push(new CDXLoader(reader).load(db));

      } else if (filename.endsWith(".idx")) {
        // For compressed indices
        console.log("Loading IDX " + filename);

        indexloaders.push(db.loadZipIndex(await db.zipreader.loadFile(filename)));

      } else if (!metadata && (filename.endsWith(".warc.gz") || filename.endsWith(".warc"))) {
        // for WR metadata at beginning of WARCS
        const abort = new AbortController();
        const reader = await db.zipreader.loadFile(filename, {signal: abort.signal, unzip: true});
        const warcinfoLoader = new WARCInfoOnlyWARCLoader(reader, abort);
        const entryTotal = db.zipreader.getCompressedSize(filename);
        metadata = await warcinfoLoader.load(db, progressUpdate, entryTotal);
      }
    }

    await Promise.all(indexloaders);
    return metadata || {};
  }

  async loadMetadata(reader) {
    const text = new TextDecoder().decode(await reader.readFully());
    const fullMetadata = yaml.safeLoad(text);
    console.log(fullMetadata);

    const metadata = {desc: fullMetadata.desc, title: fullMetadata.title};

    // All pages
    const pages = fullMetadata.pages || [];

    if (pages && pages.length) {
      await this.addPages(pages);
    }

    // Curated Pages
    const pageLists = fullMetadata.pageLists || [];

    if (pageLists && pageLists.length) {
      await this.addCuratedPageLists(pageLists, "pages", "show");
    }

    return metadata;
  }

  async loadSource(source) {
    let filename;
    let offset = 0;
    let length = -1;

    if (typeof(source) === "string") {
      filename = source;
    } else if (typeof(source) === "object") {
      offset = source.start;
      length = source.length;
      filename = source.path;
    } else {
      return null;
    }

    return await this.zipreader.loadWARC(filename, offset, length);
  }

  getSurt(url) {
    try {
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
    const surt = this.getSurt(url);

    const prefix = surt + " " + timestamp;

    const tx = this.db.transaction("ziplines", "readonly");

    const values = [];

    // and first match
    const key = IDBKeyRange.upperBound(surt + " " + timestamp, true);

    for await (const cursor of tx.store.iterate(key, "prev")) {
      values.push(cursor.value);
      break;
    }

    // add matches for range, if any
    const rangeKey = IDBKeyRange.bound(surt + " " + timestamp, surt + "!", false, true);

    for await (const cursor of tx.store.iterate(rangeKey)) {
      values.push(cursor.value);
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

  async lookupUrl(url, datetime, skip = 0) {
    let result = await super.lookupUrl(url, datetime, skip);

    if (result) {
      return result;
    }

    if (await this.loadFromZiplines(url, datetime)) {
      result = await super.lookupUrl(url, datetime, skip);
    }

    return result;
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

  async load() {
    if (!this.entries) {
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

  async loadWARC(name, offset, length) {
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

