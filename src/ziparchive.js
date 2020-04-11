import { StreamReader } from 'warcio';
import { RemoteArchiveDB } from './remotearchivedb';
import { SingleRecordWARCLoader } from './warcloader';
import { CDXLoader } from './cdxloader';


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

    const reader = await this.zipreader.loadWARC(filename, offset, length);

    return new StreamReader(reader);
  }
}


const MAX_INT32 = 0xFFFFFFFF;
const MAX_INT16 = 0xFFFF;


// ===========================================================================
class ZipRangeReader
{
  constructor(url) {
    this.url = url;
    this.length = null;
    this.entries = null;
  }

  async getLength() {
    if (this.length === null) {
      const resp = await fetch(this.url, {"method": "HEAD"});
      this.length = resp.headers.get("Content-Length");
    }
    return this.length;
  }

  async getRange(offset, length, stream = false) {
    const resp = await fetch(this.url, {"headers":
      {"Range": `bytes=${offset}-${offset + length - 1}`}
    });

    if (stream) {
      return resp.body;
    } else {
      return new Uint8Array(await resp.arrayBuffer());
    }
  }

  async load() {
    const totalLength = await this.getLength();
    const length = (MAX_INT16 + 23);
    const start = totalLength - length;
    const endChunk = await this.getRange(start, length);

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

    return await this.loadFile(name, offset, length);
  }

  async loadFile(name, offset = 0, length = -1) {
    if (this.entries === null) {
      await this.load();
    }

    const entry = this.entries[name];

    if (!entry) {
      return null;
    }

    if (entry.offset === undefined) {
      const header = await this.getRange(entry.localEntryOffset, 30);
      const view = new DataView(header.buffer);

      const fileNameLength = view.getUint16(26, true);
      const extraFieldLength = view.getUint16(28, true);

      entry.offset = 30 + fileNameLength + extraFieldLength + entry.localEntryOffset;
    }

    length = length < 0 ? entry.compressedSize : Math.min(length, entry.compressedSize - offset);

    offset += entry.offset;

    const body = await this.getRange(offset, length, true);
    return new StreamReader(body.getReader(), entry.deflate ? "deflate" : null);
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

