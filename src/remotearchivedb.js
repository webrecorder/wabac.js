import { ArchiveDB } from './archivedb';
import { SingleRecordWARCLoader } from './warcloader';
import { concatChunks } from 'warcio';


// ===========================================================================
class RemoteArchiveDB extends ArchiveDB
{
  constructor(name, remoteUrlPrefix) {
    super(name);

    this.remoteUrlPrefix = remoteUrlPrefix;
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
    if (remote.stream) {
      if (getRewriteMode({url: cdx.url, mime: cdx.mime}) || cdx.source && (cdx.source.length && cdx.source.length < 100000)) { 
        remote.payload = await remote.stream.readFully();
      } else {
        console.log(`Keep stream for ${cdx.url} size ${cdx.source.length}`);
      }
    }
*/
    const digest = remote.digest;

    if (remote.stream && digest) {
      remote.stream = new PayloadBufferingReader(this, remote.stream, digest, cdx.url);
    }

    payload = remote.payload;

    if (!payload && !remote.stream) {
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

    return remote.stream;
  }

  async commitPayload(payload, digest) {
    const tx = this.db.transaction(["payload", "digestRef"], "readwrite");

    if (!payload) {
      return;
    }

    try {
      const payloadEntry = await tx.objectStore("payload").get(digest);
      payloadEntry.payload = payload;
      tx.objectStore("payload").put(payloadEntry);

      const ref = await tx.objectStore("digestRef").get(digest);
      ref.size = payload.length;
      tx.objectStore("digestRef").put(ref);
    } catch (e) {
      console.warn('Payload Commit Error: ' + e);
    }
  }
}


// ===========================================================================
class PayloadBufferingReader
{
  constructor(db, stream, digest, url = "") {
    this.db = db;
    this.stream = stream;

    this.digest = digest;
    this.url = url;

    this.chunks = [];
    this.size = 0;
    this.fullbuff = null;

    this.commit = true;
    this.readingFully = false;
  }

  setLimitSkip(limit = -1, skip = 0) {
    if (limit != -1 && skip > 0) {
      this.commit = false;
    }
    this.stream.setLimitSkip(limit, skip);
  }

  async read(fullRead = false) {
    let res = await this.stream.read();
    const chunk = res.value;

    if (!fullRead && !this.commit) {
      return {value: chunk, done: !chunk};
    }

    if (chunk) {
      this.chunks.push(chunk);
      this.size += chunk.byteLength;
    } else {
      this.fullbuff = concatChunks(this.chunks, this.size);

      if (this.commit) {
        await this.db.commitPayload(this.fullbuff, this.digest);
      }
    }

    return {value: chunk, done: !chunk};
  }

  async readFully() {
    let chunk = null;
    let res = null;

    while (res = await this.read(true), chunk = res.value);

    return this.fullbuff;
  }

  async* iterChunks() {
    let res = null;
    while (res = await this.read(), res.value && !res.done) {
      yield res.value;
    }
  }
}


export { RemoteArchiveDB };

