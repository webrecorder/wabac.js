import { ArchiveDB } from './archivedb';
import { SingleRecordWARCLoader } from './warcloader';
import { BaseAsyncIterReader } from 'warcio';

import { createLoader } from './blockloaders';


// ===========================================================================
class OnDemandPayloadArchiveDB extends ArchiveDB
{
  constructor(name, noCache = false) {
    super(name);
    this.noCache = noCache;

    this.useRefCounts = !noCache;
  }

  async loadRecordFromSource(cdx) {
    const responseStream = await this.loadSource(cdx.source);

    const loader = new SingleRecordWARCLoader(responseStream);

    return await loader.load();
  }

  async loadPayload(cdx, depth = 0) {
    let payload = await super.loadPayload(cdx);
    if (payload) {
      if (cdx.respHeaders && cdx.mime !== "warc/revisit") {
        return payload;
      }
    }

    const remote = await this.loadRecordFromSource(cdx);
 
    if (!remote) {
      console.log(`No WARC Record Loaded for: ${cdx.url}`);
      return null;
    }

    if (remote.url !== cdx.url) {
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

    if (remote.digest !== cdx.digest) {
      console.log(`Wrong digest: expected ${cdx.digest}, got ${remote.digest}`);
      //return null;
    }

    // Revisit
    if (remote.origURL) {
      const origResult = await this.lookupUrl(remote.origURL, remote.origTS, {noRevisits: true});
      if (!origResult) {
        return null;
      }

      if (!payload) {
        if (depth < 2) {
          payload = await this.loadPayload(origResult, depth + 1);
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
      remote.reader = new PayloadBufferingReader(this, remote.reader, digest, cdx.url);
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
      console.warn('Payload Commit Error: ' + e);
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

    const loader = createLoader(url, headers);

    return await loader.getRange(start, length, true);
  }
}


// ===========================================================================
class PayloadBufferingReader extends BaseAsyncIterReader
{
  constructor(db, reader, digest, url = "") {
    super();
    this.db = db;
    this.reader = reader;

    this.digest = digest;
    this.url = url;

    this.chunks = [];
    this.size = 0;
    this.fullbuff = null;

    this.commit = true;
    this.alreadyRead = false;
  }

  setLimitSkip(limit = -1, skip = 0) {
    if (limit != -1 || skip > 0) {
      this.commit = false;
    }
    this.reader.setLimitSkip(limit, skip);
  }

  async* [Symbol.asyncIterator]() {
    if (this.alreadyRead) {
      return;
    }

    for await (const chunk of this.reader) {
      this.chunks.push(chunk);
      this.size += chunk.byteLength;

      yield chunk;
    }

    this.fullbuff = BaseAsyncIterReader.concatChunks(this.chunks, this.size);

    // if limit is not 0, didn't consume expected amount... something likely wrong
    if (this.reader.limit !== 0) {
      console.warn(`Expected payload not consumed, ${this.reader.limit} bytes left`);
    } else if (this.commit) {
      await this.db.commitPayload(this.fullbuff, this.digest);
    }

    this.chunks = [];
    this.alreadyRead = true;
  }

  async readFully() {
    for await (const chunk of this);
    return this.fullbuff;
  }
}


export { OnDemandPayloadArchiveDB, RemotePrefixArchiveDB, RemoteSourceArchiveDB, SingleRecordWARCLoader };

