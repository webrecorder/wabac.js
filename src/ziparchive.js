import { AsyncIterReader } from 'warcio';
import { RemoteArchiveDB } from './remotearchivedb';
import { SingleRecordWARCLoader, WARCInfoOnlyWARCLoader } from './warcloader';
import { CDXLoader } from './cdxloader';
import { getTS } from './utils';


// ===========================================================================
class ZipRemoteArchiveDB extends RemoteArchiveDB
{
  constructor(name, remoteUrl) {
    super(name, remoteUrl);
    this.zipreader = new ZipRangeReader(remoteUrl);
  }

  async load(db) {
    if (db !== this) {
      console.error("wrong db");
      return;
    }

    await this.zipreader.load();

    const cdxloaders = [];
    for (const filename of Object.keys(this.zipreader.entries)) {
      if (filename.endsWith(".cdx") || filename.endsWith(".cdxj")) {
        const reader = await this.zipreader.loadFile(filename);
        const loader = new CDXLoader(reader);
        cdxloaders.push(loader.load(db));
        console.log("Loading CDX " + filename);
      } else if (filename.endsWith(".idx")) {
        await this.loadZipIndex(await this.zipreader.loadFile(filename));
      } else if (filename.endsWith(".warc.gz") || filename.endsWith(".warc")) {

        const abort = new AbortController();
        const reader = await this.zipreader.loadFile(filename, {signal: abort.signal, unzip: true});
        const warcinfoLoader = new WARCInfoOnlyWARCLoader(reader, abort);
        await warcinfoLoader.load(this);
      }
    }

    await Promise.all(cdxloaders);
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


  _initDB(db, oldV, newV, tx) {
    super._initDB(db, oldV, newV, tx);

    const ziplStore = db.createObjectStore("ziplines", { keyPath: "prefix" });
  }

  async loadZipIndex(reader) {
    for await (const line of reader.iterLines()) {
      let [prefix, filename, offset, length] = line.split('\t');
      offset = Number(offset);
      length = Number(length);

      await this.db.put("ziplines", {prefix, filename, offset, length, loaded: false});
    }
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

  async lookupUrl(url, datetime, skip = 0) {
    let result = await super.lookupUrl(url, datetime, skip);

    if (result) {
      return result;
    }

    const timestamp = datetime ? getTS(new Date(datetime).toISOString()) : "";
    const surt = this.getSurt(url);

    const prefix = surt + " " + timestamp;

    const tx = this.db.transaction("ziplines", "readwrite");

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

    console.log(values);

    await tx.done;

    const cdxloaders = [];

    for (const zipblock of values) {
      if (zipblock.loaded) {
        console.log('already loaded');
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

    if (cdxloaders.length > 0) {
      result = await super.lookupUrl(url, datetime, skip);
    }

    return result;
  }
}


// ===========================================================================
class HttpRangeLoader
{
  constructor(url) {
    this.url = url;
    this.length = null;
  }

  async getLength() {
    if (this.length === null) {
      try {
        const resp = await fetch(this.url, {"method": "HEAD"});
        this.length = resp.headers.get("Content-Length");
      } catch(e) {
        const abort = new AbortController();
        const signal = abort.signal;
        const resp = await fetch(this.url, {signal});
        this.length = resp.headers.get("Content-Length");
        abort.abort();
      }
    }
    return this.length;
  }

  async getRange(offset, length, streaming = false, signal) {
    if (this.length === null) {
      await this.getLength();
    }

    const options = {signal, headers: {
      "Range": `bytes=${offset}-${offset + length - 1}`
    }};

    let resp = null;

    try {
      resp = await fetch(this.url, options);
    } catch(e) {
      console.log(e);
    }

    if (streaming) {
      return resp.body;
    } else {
      return new Uint8Array(await resp.arrayBuffer());
    }
  } 
}


// ===========================================================================
class BlobLoader
{
  constructor(url) {
    this.url = url;
    this.blob = null;
  }

  async getLength() {
    if (!this.blob) {
      const resp = await fetch(this.url);
      this.blob = await resp.blob();
    }
    return this.blob.size;
  }

  async getRange(offset, length, streaming = false, signal) {
    if (!this.blob) {
      await this.getLength();
    }

    const blobChunk = this.blob.slice(offset, offset + length, "application/octet-stream");

    if (streaming) {
      return blobChunk.stream ? blobChunk.stream() : this.getReadableStream(blobChunk);
    } else {
      try {
        const ab = blobChunk.arrayBuffer ? await blobChunk.arrayBuffer() : await this.getArrayBuffer(blobChunk);
        return new Uint8Array(ab);
      } catch(e) {
        console.log("error reading blob", e);
        return null;
      }
    }
  }

  getArrayBuffer(blob) {
    return new Promise((resolve) => {
      let fr = new FileReader();
      fr.onloadend = () => {
        resolve(fr.result);
      };
      fr.readAsArrayBuffer(blob);
    });
  }

  async getReadableStream(blob) {
    const ab = await this.getArrayBuffer(blob);

    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(ab));
        controller.close();
      }
    });
  }
}


// ===========================================================================
const MAX_INT32 = 0xFFFFFFFF;
const MAX_INT16 = 0xFFFF;


// ===========================================================================
class ZipRangeReader
{
  constructor(url) {
    if (self.location) {
      url = new URL(url, self.location.href).href;
    }

    if (url.startsWith("blob:")) {
      this.loader = new BlobLoader(url);
    } else if (url.startsWith("http:") || url.startsWith("https:")) {
      this.loader = new HttpRangeLoader(url);
    } else {
      throw new Error("Invalid URL: " + url);
    }

    this.entries = null;
  }

  async load() {
    const totalLength = await this.loader.getLength();
    const length = (MAX_INT16 + 23);
    const start = totalLength - length;
    const endChunk = await this.loader.getRange(start, length);

    this.entries = this._loadEntries(endChunk, start);
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
      zip64 = true;
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

