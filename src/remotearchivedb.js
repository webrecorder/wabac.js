import { ArchiveDB } from "./archivedb";
import { SingleRecordWARCLoader } from "./warcloader";
import { BaseAsyncIterReader, AsyncIterReader, LimitReader, concatChunks } from "warcio";

import { createLoader } from "./blockloaders";


// ===========================================================================
class OnDemandPayloadArchiveDB extends ArchiveDB
{
  constructor(name, noCache = false) {
    super(name);
    this.noCache = noCache;

    this.useRefCounts = !noCache;

    this.streamMap = new Map();
  }

  async loadRecordFromSource(cdx) {
    const responseStream = await this.loadSource(cdx.source);

    const loader = new SingleRecordWARCLoader(responseStream);

    return await loader.load();
  }

  async loadPayload(cdx, opts) {
    let payload = await super.loadPayload(cdx, opts);
    if (payload) {
      if (cdx.respHeaders && cdx.mime !== "warc/revisit") {
        return payload;
      }
    }

    const chunkstore = this.streamMap.get(cdx.url);
    if (chunkstore) {
      console.log(`Reuse stream for ${cdx.url}`);
      return new PartialStreamReader(chunkstore);
    }

    const remote = await this.loadRecordFromSource(cdx);
 
    if (!remote) {
      console.log(`No WARC Record Loaded for: ${cdx.url}`);
      return null;
    }

    if (remote.url !== cdx.url && !(cdx.method && cdx.url.startsWith(remote.url))) {
      console.log(`Wrong url: expected ${cdx.url}, got ${remote.url}`);
      return null;
    }

    if (remote.ts !== cdx.ts) {
      const rounded = Math.floor(remote.ts / 1000) * 1000;
      if (rounded !== cdx.ts) {
        console.log(`Wrong timestamp: expected ${cdx.ts}, got ${remote.ts}`);
        return null;
      }
    }

    if (remote.digest !== cdx.digest && cdx.digest && remote.digest) {
      const remoteDigestParts = remote.digest.split(":");
      const cdxDigestParts = cdx.digest.split(":");
      if (remoteDigestParts.length === 2 && cdxDigestParts.length === 2 && 
        cdxDigestParts[1] === remoteDigestParts[1]) {
        cdx.digest = remoteDigestParts[0] + ":" + cdxDigestParts[1];
      } else {
        console.log(`Wrong digest: expected ${cdx.digest}, got ${remote.digest}`);
      }
      //return null;
    }

    // Revisit
    if (remote.origURL) {
      const origResult = await this.lookupUrl(remote.origURL, remote.origTS, {...opts, noRevisits: true});
      if (!origResult) {
        return null;
      }

      const depth = opts && opts.depth || 0;

      if (!payload) {
        if (depth < 2) {
          payload = await this.loadPayload(origResult, {...opts, depth: depth + 1});
        } else {
          console.warn("Avoiding revisit lookup loop for: " + JSON.stringify(remote));
        }
        if (!payload) {
          return null;
        }
      }

      cdx.respHeaders = origResult.respHeaders;
      cdx.mime = origResult.mime;

      if (origResult.extraOpts) {
        cdx.extraOpts = origResult.extraOpts;
      }

      // update revisit data if cacheing
      if (!this.noCache) {
        // don't store in resources db
        delete cdx.payload;

        try {
          await this.db.put("resources", cdx);
        } catch(e) {
          console.log(e);
        }

        // cache here only if somehow the digests don't match (wrong digest from previous versions?)
        if (origResult.digest !== remote.digest && !payload[Symbol.asyncIterator]) {
          await this.commitPayload(payload, remote.digest);
        }
      }

      return payload;
    }

    const digest = remote.digest;

    if (!this.noCache && remote.reader && digest) {
      remote.reader = new PayloadBufferingReader(this, remote.reader, digest, cdx.url, this.streamMap);
    }

    payload = remote.payload;

    if (!payload && !remote.reader) {
      return null;
    }

    // Update payload if cacheing
    try {
      if (payload && !this.noCache) {
        await this.commitPayload(payload, digest);
      }
    } catch(e) {
      console.warn(`Payload Update Error: ${cdx.url}`);
      console.warn(e);
    }

    // Update resources if headers or digest missing
    if (!cdx.respHeaders || !cdx.digest) {
      cdx.respHeaders = remote.respHeaders;
      cdx.digest = digest;
      if (remote.extraOpts) {
        cdx.extraOpts = remote.extraOpts;
      }

      if (!this.noCache) {
        try {
          await this.db.put("resources", cdx);
        } catch (e) {
          console.warn(`Resource Update Error: ${cdx.url}`);
          console.warn(e);
        }
      }
    }

    return payload ? payload : remote.reader;
  }

  async commitPayload(payload, digest) {
    if (!payload || payload.length === 0) {
      return;
    }

    const tx = this.db.transaction(["payload", "digestRef"], "readwrite");

    try {
      //const payloadEntry = await tx.objectStore("payload").get(digest);
      //payloadEntry.payload = payload;
      tx.objectStore("payload").put({payload, digest});

      if (this.useRefCounts) {
        const ref = await tx.objectStore("digestRef").get(digest);
        if (ref) {
          ref.size = payload.length;
          tx.objectStore("digestRef").put(ref);
        }
      }

      await tx.done;

    } catch (e) {
      console.warn("Payload Commit Error: " + e);
    }
  }
}


// ===========================================================================
class RemoteSourceArchiveDB extends OnDemandPayloadArchiveDB
{
  constructor(name, loader, noCache = false) {
    super(name, noCache);

    this.loader = loader;
  }

  updateHeaders(headers) {
    this.loader.headers = headers;
  }

  async loadSource(source) {
    const { start, length } = source;

    return await this.loader.getRange(start, length, true);
  }
}


// ===========================================================================
class RemotePrefixArchiveDB extends OnDemandPayloadArchiveDB
{
  constructor(name, remoteUrlPrefix, headers, noCache = false) {
    super(name, noCache);

    this.remoteUrlPrefix = remoteUrlPrefix;
    this.headers = headers;
  }

  updateHeaders(headers) {
    this.headers = headers; 
  }

  async loadSource(source) {
    const { start, length } = source;

    const headers =  new Headers(this.headers);
    const url = new URL(source.path, this.remoteUrlPrefix).href;

    const loader = await createLoader(url, headers);

    return await loader.getRange(start, length, true);
  }
}


// ===========================================================================
class PartialStreamReader extends BaseAsyncIterReader
{
  constructor(chunkstore) {
    super();
    this.chunkstore = chunkstore;
    this.offset = 0;
    this.size = this.chunkstore.totalLength;
  }

  setLimitSkip(limit = -1, skip = 0) {
    this.offset = skip;
    if (limit > 0) {
      this.size = limit;
    }
  }

  setRangeAll(length) {
    this.size = length;
  }

  getReadableStream() {
    console.log(`Offset: ${this.offset}, Size: ${this.size}`);

    const reader = this.chunkstore.getChunkIter();

    const limitreader = new LimitReader(reader, this.size, this.offset);
    return limitreader.getReadableStream();
  }
}

// ===========================================================================
class ChunkStore
{
  constructor(totalLength) {
    this.chunks = [];
    this.size = 0;
    this.done = false;
    this.totalLength = totalLength;

    this.nextChunk = new Promise(resolve => this._nextResolve = resolve);
  }

  add(chunk) {
    this.chunks.push(chunk);
    this.size += chunk.byteLength;
    this._nextResolve(true);
    this.nextChunk = new Promise(resolve => this._nextResolve = resolve);
  }

  concatChunks() {
    this._nextResolve(false);
    this.done = true;

    return concatChunks(this.chunks, this.size);
  }

  async* getChunkIter() {
    for (const chunk of this.chunks) {
      yield chunk;
    }

    let i = this.chunks.length;

    while (!this.done) {
      if (!await this.nextChunk) {
        break;
      }

      for (i; i < this.chunks.length; i++) {
        yield this.chunks[i];
      }
    }
  }
}


// ===========================================================================
class PayloadBufferingReader extends BaseAsyncIterReader
{
  constructor(db, reader, digest, url = "", streamMap) {
    super();
    this.db = db;
    this.reader = reader;

    this.digest = digest;
    this.url = url;

    this.commit = true;
    this.fullbuff = null;

    this.isRange = false;
    this.totalLength = -1;

    this.streamMap = streamMap;
  }

  setRangeAll(length) {
    this.isRange = true;
    this.totalLength = length;
  }

  setLimitSkip(limit = -1, skip = 0) {
    this.isRange = true;

    if (limit === 2 && skip === 0) {
      this.fixedSize = 2;
      return;
    }

    if (limit != -1 || skip > 0) {
      this.commit = false;
    }
    this.reader.setLimitSkip(limit, skip);
  }

  async* [Symbol.asyncIterator]() {
    let chunkstore = null;

    if (this.commit) {
      chunkstore = new ChunkStore(this.totalLength);

      if (this.isRange) {
        console.log(`Store stream for ${this.url}, ${this.totalLength}`);
        this.streamMap.set(this.url, chunkstore);
      }
    }

    for await (const chunk of this.reader) {
      if (chunkstore) {
        chunkstore.add(chunk);
      }

      yield chunk;
    }

    if (this.reader.limit !== 0) {
      console.warn(`Expected payload not consumed, ${this.reader.limit} bytes left`);
    } else if (this.commit) {
      this.fullbuff = chunkstore.concatChunks();
      await this.db.commitPayload(this.fullbuff, this.digest);
    }

    if (this.commit && this.isRange) {
      this.streamMap.delete(this.url);
      console.log(`Delete stream for ${this.url}`);
    }
  }

  async _consumeIter(iter) {
    // eslint-disable-next-line no-unused-vars
    for await (const chunk of iter);
  }

  async readFully() {
    if (!this.fullbuff) {
      // should not set if already false
      //this.commit = true;
      await this._consumeIter(this);
    }
    return this.fullbuff;
  }

  getReadableStream() {
    const stream = super.getReadableStream();

    if (!this.commit) {
      return stream;
    }

    // if committing, need to consume entire stream, so tee reader and consume async
    const tees = stream.tee();

    this._consumeIter(AsyncIterReader.fromReadable(tees[1].getReader()));

    // load a single, fixed chunk (only used for 0-1 safari range)
    if (this.fixedSize) {
      return this.getFixedSizeReader(tees[0].getReader(), this.fixedSize);
    } else {
      return tees[0];
    }
  }

  getFixedSizeReader(reader, size) {
    return new ReadableStream({
      async start(controller) {
        const {value, done} = await reader.read();
        if (!done) {
          controller.enqueue(value.slice(0, size));
        }
        controller.close();
        reader.close();
      }
    });
  }
}


export { OnDemandPayloadArchiveDB, RemotePrefixArchiveDB, RemoteSourceArchiveDB };

