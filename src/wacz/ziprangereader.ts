import { AsyncIterReader, concatChunks } from "warcio";
import { createSHA256 } from "hash-wasm";
import { BaseLoader, getReadableStreamFromIter } from "../blockloaders";
import { type IHasher } from "hash-wasm/dist/lib/WASMInterface.js";

// ===========================================================================
const MAX_INT32 = 0xffffffff;
const MAX_INT16 = 0xffff;

// ===========================================================================
export type GetHash = {
  getHash: () => string;
};

export type ReaderAndHasher = {
  reader: AsyncIterReader;
  hasher?: GetHash | null;
};

export type LoadWACZEntry = Promise<ReaderAndHasher>;

export type ZipEntry = {
  filename: string;
  deflate: boolean;
  uncompressedSize: number;
  compressedSize: number;
  localEntryOffset: number;
  offset?: number;
};

// ===========================================================================
class LoadMoreException {
  start: number;
  length: number;

  constructor(start: number, length: number) {
    this.start = start;
    this.length = length;
  }
}

// ===========================================================================
export class HashingAsyncIterReader extends AsyncIterReader implements GetHash {
  hasher: IHasher | null = null;
  hashInited = false;
  hash = "";

  constructor(source: AsyncIterReader, compressed = "gzip", dechunk = false) {
    super(source, compressed, dechunk);
  }

  async initHasher() {
    try {
      this.hasher = await createSHA256();
    } catch (e) {
      console.warn("Hasher init failed, not hashing", e);
    } finally {
      this.hashInited = true;
    }
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'AsyncIterReader'.
  async _loadNext() {
    const value = await super._loadNext();
    if (value) {
      if (!this.hashInited) {
        await this.initHasher();
      }
      this.hasher!.update(value);
    } else if (this.hasher) {
      this.hash = "sha256:" + this.hasher.digest("hex");
      this.hasher = null;
    }
    return value;
  }

  getHash(): string {
    return this.hash;
  }
}

// ===========================================================================
export class ZipRangeReader {
  loader: BaseLoader;
  entriesUpdated = false;
  enableHashing = false;
  entries: Record<string, ZipEntry> | null = null;

  constructor(
    loader: BaseLoader,
    entries: Record<string, ZipEntry> | null = null,
  ) {
    this.loader = loader;
    this.entries = entries;
    this.entriesUpdated = false;

    // todo: make configurable
    this.enableHashing = true;
  }

  async load(always = false): Promise<Record<string, ZipEntry>> {
    if (!this.entries || always) {
      const endChunkOffset = MAX_INT16 + 23;
      const endChunk = (await this.loader.getRangeFromEnd(
        endChunkOffset,
        false,
      )) as Uint8Array;

      const start = Math.max(
        (await this.loader.getLength()) - endChunkOffset,
        0,
      );

      try {
        this.entries = this._loadEntries(endChunk, start);
      } catch (e) {
        if (e instanceof LoadMoreException) {
          const extraChunk = (await this.loader.getRange(
            e.start,
            e.length,
            false,
          )) as Uint8Array;
          const combinedChunk = concatChunks(
            [extraChunk, endChunk],
            e.length + length,
          );
          this.entries = this._loadEntries(combinedChunk, e.start);
        }
      }

      this.entriesUpdated = true;
    }
    return this.entries!;
  }

  _loadEntries(
    data: Uint8Array,
    dataStartOffset: number, // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Record<string, any> | null {
    // Adapted from
    // Copyright (c) 2016 Rob Wu <rob@robwu.nl> (https://robwu.nl)
    //  * Published under a MIT license.
    // * https://github.com/Rob--W/zipinfo.js
    const length = data.byteLength;

    if (!length) {
      return null;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const utf8Decoder = new TextDecoder("utf8");
    const asciiDecoder = new TextDecoder("ascii");
    const entries: Record<string, ZipEntry> = {};

    let entriesLeft = 0;
    let offset = 0;
    let endoffset = length;
    // Find EOCD (0xFFFF is the maximum size of an optional trailing comment).
    for (let i = length - 22, ii = Math.max(0, i - MAX_INT16); i >= ii; --i) {
      if (
        data[i] === 0x50 &&
        data[i + 1] === 0x4b &&
        data[i + 2] === 0x05 &&
        data[i + 3] === 0x06
      ) {
        endoffset = i;
        offset = view.getUint32(i + 16, true);
        entriesLeft = view.getUint16(i + 8, true);
        break;
      }
    }

    //ZIP64 find offset
    if (offset === MAX_INT32 || entriesLeft === MAX_INT16) {
      if (view.getUint32(endoffset - 20, true) !== 0x07064b50) {
        console.warn("invalid zip64 EOCD locator");
        return null;
      }

      const zip64Offset = this.getUint64(view, endoffset - 12, true);

      const viewOffset = zip64Offset - dataStartOffset;

      if (view.getUint32(viewOffset, true) !== 0x06064b50) {
        console.warn("invalid zip64 EOCD record");
        return null;
      }

      entriesLeft = this.getUint64(view, viewOffset + 32, true);
      offset = this.getUint64(view, viewOffset + 48, true);
      //zip64 = true;
    }

    if (offset >= dataStartOffset) {
      offset -= dataStartOffset;
    } else if (offset < dataStartOffset && offset > 0) {
      throw new LoadMoreException(offset, dataStartOffset - offset);
    }

    if (offset >= length || offset < 0) {
      // EOCD not found or malformed. Try to recover if possible (the result is
      // most likely going to be incomplete or bogus, but we can try...).
      offset = -1;
      entriesLeft = MAX_INT16;
      while (
        ++offset < length &&
        data[offset] !== 0x50 &&
        data[offset + 1] !== 0x4b &&
        data[offset + 2] !== 0x01 &&
        data[offset + 3] !== 0x02
      );
    }

    endoffset -= 46; // 46 = minimum size of an entry in the central directory.

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

      const deflate = view.getUint16(offset + 10, true) === 8;

      let localEntryOffset = view.getUint32(offset + 42, true);

      const decoder = bitFlag & 0x800 ? utf8Decoder : asciiDecoder;
      const filename = decoder.decode(
        data.subarray(offset + 46, offset + 46 + fileNameLength),
      );

      // ZIP64 support
      if (
        compressedSize === MAX_INT32 ||
        uncompressedSize === MAX_INT32 ||
        localEntryOffset === MAX_INT32
      ) {
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

          extraFieldOffset += size;
        }
      }

      const directory = filename.endsWith("/");

      if (!directory) {
        entries[filename] = {
          filename,
          deflate,
          uncompressedSize,
          compressedSize,
          localEntryOffset,
        };

        // optimization if no extraFieldLength, can set offset and avoid extra lookup
        if (!extraFieldLength) {
          entries[filename].offset = 30 + fileNameLength + localEntryOffset;
        }
      }

      offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
    return entries;
  }

  getCompressedSize(name: string): number {
    if (this.entries === null) {
      return 0;
    }

    const entry = this.entries[name];

    if (!entry) {
      return 0;
    }

    return isNaN(entry.compressedSize) ? 0 : entry.compressedSize;
  }

  async loadFile(
    name: string,
    {
      offset = 0,
      length = -1,
      signal = null,
      unzip = false,
      computeHash = false,
    }: {
      offset?: number;
      length?: number;
      signal?: AbortSignal | null;
      unzip?: boolean;
      computeHash?: boolean;
    } = {},
  ): Promise<ReaderAndHasher> {
    if (this.entries === null) {
      await this.load();
    }

    if (!this.entries) {
      throw new Error("entries not loaded");
    }

    const entry = this.entries[name];

    if (!entry) {
      throw new Error("file not found in zip: " + name);
    }

    if (entry.offset === undefined) {
      const header = (await this.loader.getRange(
        entry.localEntryOffset,
        30,
        false,
      )) as Uint8Array;
      const view = new DataView(
        header.buffer,
        header.byteOffset,
        header.byteLength,
      );

      const fileNameLength = view.getUint16(26, true);
      const extraFieldLength = view.getUint16(28, true);

      entry.offset =
        30 + fileNameLength + extraFieldLength + entry.localEntryOffset;
      this.entriesUpdated = true;
    }

    length =
      length < 0
        ? entry.compressedSize
        : Math.min(length, entry.compressedSize - offset);

    offset += entry.offset;

    const body = (await this.loader.getRange(
      offset,
      length,
      true,
      signal,
    )) as ReadableStream;

    const streamReader: ReadableStreamDefaultReader = body.getReader();
    let hasher: HashingAsyncIterReader | null = null;

    const wrapHasher = (reader: AsyncIterReader): AsyncIterReader => {
      if (computeHash && this.enableHashing) {
        hasher = new HashingAsyncIterReader(reader);
        return hasher;
      }
      return reader;
    };

    let reader: AsyncIterReader;

    // if not unzip, deflate if needed only
    if (!unzip) {
      reader = new AsyncIterReader(
        streamReader,
        entry.deflate ? "deflate" : null,
      );
      // if unzip and not deflated, reuse AsyncIterReader for auto unzipping
    } else if (!entry.deflate) {
      reader = new AsyncIterReader(streamReader);
    } else {
      // need to deflate, than unzip again
      reader = new AsyncIterReader(
        new AsyncIterReader(streamReader, "deflate"),
      );
    }

    reader = wrapHasher(reader);

    return { reader, hasher };
  }

  // from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView
  getUint64(dataview: DataView, byteOffset: number, littleEndian: boolean) {
    // split 64-bit number into two 32-bit (4-byte) parts
    const left = dataview.getUint32(byteOffset, littleEndian);
    const right = dataview.getUint32(byteOffset + 4, littleEndian);

    // combine the two 32-bit values
    const combined = littleEndian
      ? left + 2 ** 32 * right
      : 2 ** 32 * left + right;

    if (!Number.isSafeInteger(combined))
      console.warn(combined, "exceeds MAX_SAFE_INTEGER. Precision may be lost");

    return combined;
  }
}

// ===========================================================================
export class ZipBlockLoader extends BaseLoader {
  zipreader: ZipRangeReader;
  filename: string;

  constructor(zipreader: ZipRangeReader, filename: string) {
    super(true);
    this.zipreader = zipreader;
    this.filename = filename;
  }

  get isValid() {
    return true;
  }

  async doInitialFetch(tryHead = false) {
    await this.zipreader.load();

    this.length = this.zipreader.getCompressedSize(this.filename);

    let stream: ReadableStream<Uint8Array> | null = null;

    if (!tryHead) {
      const { reader } = await this.zipreader.loadFile(this.filename, {
        unzip: true,
      });
      stream = getReadableStreamFromIter(reader);
    }

    const response = new Response(stream);

    return { response, abort: null };
  }

  async getLength() {
    if (this.length === null) {
      await this.doInitialFetch(true);
    }

    return this.length || 0;
  }

  async getRange(
    offset: number,
    length: number,
    streaming = false,
    signal = null,
  ) {
    const { reader } = await this.zipreader.loadFile(this.filename, {
      offset,
      length,
      signal,
      unzip: true,
    });

    if (streaming) {
      return getReadableStreamFromIter(reader);
    } else {
      return await reader.readFully();
    }
  }
}
