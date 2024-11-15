import { ArchiveDB, type ADBOpts } from "./archivedb";
import { SingleRecordWARCLoader } from "./warcloader";
import {
  BaseAsyncIterReader,
  AsyncIterReader,
  LimitReader,
  concatChunks,
} from "warcio";

import { type BaseLoader, createLoader } from "./blockloaders";
import {
  type Source,
  type ResourceEntry,
  type RemoteResourceEntry,
} from "./types";
import { type GetHash } from "./wacz/ziprangereader";

const MAX_CACHE_SIZE = 25_000_000;

export type LoadRecordFromSourceType = Promise<{
  remote: ResourceEntry | null;
  hasher?: GetHash | null;
}>;

export type Opts = ADBOpts & {
  depth?: number;
};

// ===========================================================================
export abstract class OnDemandPayloadArchiveDB extends ArchiveDB {
  noCache: boolean;
  streamMap: Map<string, ChunkStore>;

  constructor(name: string, noCache = false) {
    super(name);
    this.noCache = noCache;

    this.useRefCounts = !noCache;

    this.streamMap = new Map<string, ChunkStore>();
  }

  isSameUrl(remoteUrl: string, cdxUrl: string, method?: string | null) {
    if (remoteUrl === cdxUrl) {
      return true;
    }

    const decodedRemoteUrl = decodeURIComponent(remoteUrl);
    const decodedCdxUrl = decodeURIComponent(cdxUrl);

    if (decodedRemoteUrl === decodedCdxUrl) {
      return true;
    }

    // if non-GET, check if cdxUrl starts with requested url
    if (method && decodedCdxUrl.startsWith(decodedRemoteUrl)) {
      return true;
    }

    return false;
  }

  abstract loadRecordFromSource(
    cdx: RemoteResourceEntry,
  ): LoadRecordFromSourceType;

  override async loadPayload(
    cdx: ResourceEntry,
    opts: Opts,
  ): Promise<BaseAsyncIterReader | Uint8Array | null> {
    let payload = await super.loadPayload(cdx, opts);
    if (payload) {
      if (
        cdx.respHeaders &&
        (cdx.mime !== "warc/revisit" ||
          (cdx.status! >= 300 && cdx.status! < 400))
      ) {
        return payload;
      }
    }

    const chunkstore = this.streamMap.get(cdx.url);
    if (chunkstore) {
      console.log(`Reuse stream for ${cdx.url}`);
      return new PartialStreamReader(chunkstore);
    }

    const { remote, hasher } = await this.loadRecordFromSource(
      cdx as RemoteResourceEntry,
    );

    if (!remote) {
      console.log(`No WARC Record Loaded for: ${cdx.url}`);
      return null;
    }

    if (!this.isSameUrl(remote.url, cdx.url, cdx.method)) {
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
      if (
        remoteDigestParts.length === 2 &&
        cdxDigestParts.length === 2 &&
        cdxDigestParts[1] === remoteDigestParts[1]
      ) {
        cdx.digest = remoteDigestParts[0] + ":" + cdxDigestParts[1];
      } else {
        console.log(
          `Wrong digest: expected ${cdx.digest}, got ${remote.digest}`,
        );
      }
      //return null;
    }

    // Revisit
    if (remote.origURL) {
      // optimize: if revisit of redirect, just set the respHeaders and return empty payload
      if (
        !payload &&
        cdx.status! >= 300 &&
        cdx.status! < 400 &&
        remote.respHeaders
      ) {
        cdx.respHeaders = remote.respHeaders;
        if (!this.noCache) {
          try {
            await this.db!.put("resources", cdx);
          } catch (e) {
            console.log(e);
          }
        }
        return new Uint8Array([]);
      }

      const origResult = await this.lookupUrl(
        remote.origURL,
        remote.origTS || 0,
        { ...opts, noRevisits: true },
      );
      if (!origResult) {
        return null;
      }

      const depth = opts.depth || 0;

      if (!payload) {
        if (depth < 2) {
          payload = await this.loadPayload(origResult, {
            ...opts,
            depth: depth + 1,
          });
        } else {
          console.warn(
            "Avoiding revisit lookup loop for: " + JSON.stringify(remote),
          );
        }
        if (!payload) {
          return null;
        }
      }

      // if revisit record has header, use those, otherwise use headers from original
      if (remote.respHeaders && origResult.respHeaders) {
        cdx.respHeaders = remote.respHeaders;
        if (origResult.respHeaders["content-length"]) {
          // ensure content-length is the original result content length always
          cdx.respHeaders["content-length"] =
            origResult.respHeaders["content-length"];
        }
      } else {
        cdx.respHeaders = origResult.respHeaders;
      }

      cdx.mime = origResult.mime;
      // ensure digest is set to original (usually same but may have different prefix)
      // to ensure proper lookup from cache
      cdx.digest = origResult.digest;

      if (origResult.extraOpts) {
        cdx.extraOpts = origResult.extraOpts;
      }

      // update revisit data if cacheing
      if (!this.noCache) {
        // don't store in resources db
        delete cdx.payload;

        try {
          await this.db!.put("resources", cdx);
        } catch (e) {
          console.log(e);
        }

        // cache here only if somehow the digests don't match (wrong digest from previous versions?)
        if (
          origResult.digest !== remote.digest &&
          remote.digest &&
          payload instanceof Uint8Array
        ) {
          await this.commitPayload(payload, remote.digest);
        }
      }

      return payload;
    }

    const digest = remote.digest;

    const tooBigForCache = cdx.source!["length"] >= MAX_CACHE_SIZE;

    if (!this.noCache && !tooBigForCache && remote.reader && digest) {
      remote.reader = new PayloadBufferingReader(
        this,
        remote.reader as LimitReader,
        digest,
        cdx.url,
        this.streamMap,
        hasher || null,
        cdx.recordDigest!,
        cdx.source,
      );
    }

    if (tooBigForCache) {
      console.log("Not cacheing, too big: " + cdx.url);
    }

    payload = remote.payload || null;

    if (!payload && !remote.reader) {
      return null;
    }

    // Update payload if cacheing
    try {
      if (payload && !this.noCache && !tooBigForCache && digest) {
        await this.commitPayload(payload, digest);
      }
    } catch (e) {
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

      if (!this.noCache && !tooBigForCache) {
        try {
          await this.db!.put("resources", cdx);
        } catch (e) {
          console.warn(`Resource Update Error: ${cdx.url}`);
          console.warn(e);
        }
      }
    }

    return payload ? payload : remote.reader || null;
  }

  async commitPayload(payload: Uint8Array | null | undefined, digest: string) {
    if (!payload || payload.length === 0) {
      return;
    }

    const tx = this.db!.transaction(["payload", "digestRef"], "readwrite");

    try {
      //const payloadEntry = await tx.objectStore("payload").get(digest);
      //payloadEntry.payload = payload;
      void tx.objectStore("payload").put({ payload, digest });

      if (this.useRefCounts) {
        const ref = await tx.objectStore("digestRef").get(digest);
        if (ref) {
          ref.size = payload.length;
          void tx.objectStore("digestRef").put(ref);
        }
      }

      await tx.done;
    } catch (e) {
      console.warn("Payload Commit Error: " + e);
    }
  }
}

// ===========================================================================
export abstract class SimpleRemoteArchiveDB extends OnDemandPayloadArchiveDB {
  abstract loadSource(source: Source): Promise<ReadableStream<Uint8Array>>;

  override async loadRecordFromSource(
    cdx: RemoteResourceEntry,
  ): LoadRecordFromSourceType {
    const responseStream = await this.loadSource(cdx.source);

    const loader = new SingleRecordWARCLoader(responseStream);

    const remote = await loader.load();
    return { remote };
  }
}

// ===========================================================================
export class RemoteSourceArchiveDB extends SimpleRemoteArchiveDB {
  loader: BaseLoader;

  constructor(name: string, loader: BaseLoader, noCache = false) {
    super(name, noCache);

    this.loader = loader;
  }

  updateHeaders(headers: Record<string, string>) {
    this.loader.headers = headers;
  }

  override async loadSource(
    source: Source,
  ): Promise<ReadableStream<Uint8Array>> {
    const { start, length } = source;

    return (await this.loader.getRange(
      start,
      length,
      true,
    )) as ReadableStream<Uint8Array>;
  }
}

// ===========================================================================
export class RemotePrefixArchiveDB extends SimpleRemoteArchiveDB {
  remoteUrlPrefix: string;
  headers: Record<string, string>;

  constructor(
    name: string,
    remoteUrlPrefix: string,
    headers: Record<string, string>,
    noCache = false,
  ) {
    super(name, noCache);

    this.remoteUrlPrefix = remoteUrlPrefix;
    this.headers = headers;
  }

  updateHeaders(headers: Record<string, string>) {
    this.headers = headers;
  }

  override async loadSource(
    source: Source,
  ): Promise<ReadableStream<Uint8Array>> {
    const { start, length } = source;

    const headers = new Headers(this.headers);
    const url = new URL(source.path, this.remoteUrlPrefix).href;

    const loader = await createLoader({ url, headers });

    return (await loader.getRange(
      start,
      length,
      true,
    )) as ReadableStream<Uint8Array>;
  }
}

// ===========================================================================
class PartialStreamReader extends BaseAsyncIterReader {
  chunkstore: ChunkStore;
  offset: number;
  size: number;

  constructor(chunkstore: ChunkStore) {
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

  setRangeAll(length: number) {
    this.size = length;
  }

  async *[Symbol.asyncIterator]() {
    yield* this.chunkstore.getChunkIter();
  }

  override getReadableStream() {
    console.log(`Offset: ${this.offset}, Size: ${this.size}`);

    const reader: AsyncGenerator<Uint8Array> = this.chunkstore.getChunkIter();

    //todo: fix this type conversion
    const limitreader = new LimitReader(
      reader as unknown as AsyncIterReader,
      this.size,
      this.offset,
    );
    return limitreader.getReadableStream();
  }

  async readlineRaw(
    _maxLength?: number | undefined,
  ): Promise<Uint8Array | null> {
    throw new Error("Method not implemented.");
  }
}

// ===========================================================================
class ChunkStore {
  chunks: Uint8Array[];
  size = 0;
  done = false;
  totalLength: number;

  nextChunk: Promise<boolean>;
  _nextResolve: (x: boolean) => void = () => {};

  constructor(totalLength: number) {
    this.chunks = [];
    this.size = 0;
    this.done = false;
    this.totalLength = totalLength;

    this.nextChunk = new Promise((resolve) => (this._nextResolve = resolve));
  }

  add(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.size += chunk.byteLength;
    this._nextResolve(true);
    this.nextChunk = new Promise((resolve) => (this._nextResolve = resolve));
  }

  concatChunks(): Uint8Array {
    this._nextResolve(false);
    this.done = true;

    return concatChunks(this.chunks, this.size);
  }

  async *getChunkIter(): AsyncGenerator<Uint8Array> {
    for (const chunk of this.chunks) {
      yield chunk;
    }

    let i = this.chunks.length;

    while (!this.done) {
      if (!(await this.nextChunk)) {
        break;
      }

      for (i; i < this.chunks.length; i++) {
        yield this.chunks[i]!;
      }
    }
  }
}

// ===========================================================================
class PayloadBufferingReader extends BaseAsyncIterReader {
  db: OnDemandPayloadArchiveDB;
  reader: LimitReader;

  digest: string;
  url: string;

  commit = true;
  fullbuff: Uint8Array | null = null;
  hasher: GetHash | null;
  expectedHash: string;
  source: Source | undefined;

  isRange = false;
  totalLength = -1;
  fixedSize = 0;

  streamMap: Map<string, ChunkStore>;

  constructor(
    db: OnDemandPayloadArchiveDB,
    reader: LimitReader,
    digest: string,
    url = "",
    streamMap: Map<string, ChunkStore>,
    hasher: GetHash | null,
    expectedHash: string,
    source: Source | undefined,
  ) {
    super();
    this.db = db;
    this.reader = reader;

    this.digest = digest;
    this.url = url;

    this.commit = true;
    this.fullbuff = null;

    this.hasher = hasher;
    this.expectedHash = expectedHash;
    this.source = source;

    this.isRange = false;
    this.totalLength = -1;

    this.streamMap = streamMap;
  }

  setRangeAll(length: number) {
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

  async *[Symbol.asyncIterator]() {
    let chunkstore: ChunkStore | null = null;

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
      console.warn(
        `Expected payload not consumed, ${this.reader.limit} bytes left`,
      );
    } else {
      if (!this.isRange && this.hasher && this.expectedHash && this.source) {
        const hash = this.hasher.getHash();
        const { path, start, length } = this.source;
        const id = `${path}:${start}-${length}`;
        void this.db.addVerifyData(id, this.expectedHash, hash);
      }

      if (this.commit) {
        this.fullbuff = chunkstore!.concatChunks();
        await this.db.commitPayload(this.fullbuff, this.digest);
      }
    }

    if (this.commit && this.isRange) {
      this.streamMap.delete(this.url);
      console.log(`Delete stream for ${this.url}`);
    }
  }

  async _consumeIter(iter: AsyncIterable<unknown>) {
    for await (const _chunk of iter);
  }

  override async readFully() {
    if (!this.fullbuff) {
      // should not set if already false
      //this.commit = true;
      await this._consumeIter(this);
    }
    return this.fullbuff!;
  }

  override getReadableStream() {
    const stream = super.getReadableStream();

    if (!this.commit) {
      return stream;
    }

    // if committing, need to consume entire stream, so tee reader and consume async
    const tees = stream.tee();

    void this._consumeIter(AsyncIterReader.fromReadable(tees[1].getReader()));

    // load a single, fixed chunk (only used for 0-1 safari range)
    if (this.fixedSize) {
      return this.getFixedSizeReader(tees[0].getReader(), this.fixedSize);
    } else {
      return tees[0];
    }
  }

  getFixedSizeReader(reader: ReadableStreamDefaultReader, size: number) {
    return new ReadableStream({
      async start(controller) {
        const { value, done } = await reader.read();
        if (!done) {
          controller.enqueue(value.slice(0, size));
        }
        controller.close();
        //(reader as any).close();
      },
    });
  }

  async readlineRaw(
    _maxLength?: number | undefined,
  ): Promise<Uint8Array | null> {
    throw new Error("Method not implemented.");
  }
}
