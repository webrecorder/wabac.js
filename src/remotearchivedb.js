import { ArchiveDB } from './archivedb';
import { SingleRecordWARCLoader } from './warcloader';
import { BaseAsyncIterReader } from 'warcio';


// ===========================================================================
class RemoteArchiveDB extends ArchiveDB
{
  constructor(name, remoteUrlPrefix) {
    super(name);

    this.remoteUrlPrefix = remoteUrlPrefix;
    this.useRefCounts = false;
  }

  async loadSource(source) {
    let response = null;

    if (typeof(source) === "string") {
      response = await self.fetch(source);
    } else if (typeof(source) === "object") {
      const { start, length } = source;
      const headers = new Headers();
      const url = source.url ? source.url : new URL(source.path, this.remoteUrlPrefix).href;

      headers.set("Range", `bytes=${start}-${start + length - 1}`);
      response = await self.fetch(url, {headers});
    } else {
      return null;
    }

    return response.body;
  }

  async loadPayload(cdx, depth = 0) {
    let payload = await super.loadPayload(cdx);
    if (payload) {
      if (cdx.respHeaders && cdx.mime !== "warc/revisit") {
        return payload;
      }
    }

    const responseStream = await this.loadSource(cdx.source);

    const remote = await new SingleRecordWARCLoader(responseStream).load();
 
    if (!remote) {
      console.log(`No WARC Record Loaded for: ${cdx.url}`);
      return null;
    }

    if (remote.url != cdx.url) {
      console.log(`Wrong url: expected ${cdx.url}, got ${remote.url}`);
      return null;
    }

    if (remote.ts != cdx.ts) {
      console.log(`Wrong timestamp: expected ${cdx.ts}, got ${remote.ts}`);
      return null;
    }

    if (remote.digest != cdx.digest) {
      console.log(`Wrong digest: expected ${cdx.digest}, got ${remote.digest}`);
      return null;
    }

    if (remote.origURL) {
      const origResult = await this.lookupUrl(remote.origURL, remote.origTS);
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
      // don't store in resources db
      delete cdx.payload;

      await this.db.put("resources", cdx);

      return payload;
    }
/*
    if (remote.reader) {
      if (getRewriteMode({url: cdx.url, mime: cdx.mime}) || cdx.source && (cdx.source.length && cdx.source.length < 100000)) { 
        remote.payload = await remote.reader.readFully();
      } else {
        console.log(`Keep reader for ${cdx.url} size ${cdx.source.length}`);
      }
    }
*/
    const digest = remote.digest;

    if (remote.reader && digest) {
      remote.reader = new PayloadBufferingReader(this, remote.reader, digest, cdx.url);
    }

    payload = remote.payload;

    if (!payload && !remote.reader) {
      return null;
    }

    try {
      const tx = this.db.transaction("resources", "readwrite");

      if (payload) {
        await this.commitPayload(digest);
      }

      cdx.respHeaders = remote.respHeaders;
      cdx.digest = digest;

      tx.store.put(cdx);
      await tx.done;

    } catch (e) {
      console.warn(`Resource Update Error: ${cdx.url}`);
      console.warn(e);
    }

    if (payload) {
      return payload;
    }

    return remote.reader;
  }

  async commitPayload(payload, digest) {
    if (!payload) {
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
    if (limit != -1 && skip > 0) {
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

    if (this.commit) {
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


export { RemoteArchiveDB };

