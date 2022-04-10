// adapted from https://github.com/phiresky/tantivy-wasm/blob/0990c5ffcb1ec40eb58f0821dbb20a0f517bb44e/src/fetch_directory.ts

export type RangeMapper = (
  fromByte: number,
  toByte: number
) => { url: string; fromByte: number; toByte: number };

export type HttpVfsProgressEvent = {
  fetchBytes: number;
};
export type LazyFileConfig = {
  /** function to map a read request to an url with read request  */
  rangeMapper: RangeMapper;
  /** must be known beforehand if there's multiple server chunks (i.e. rangeMapper returns different urls) */
  fileLength?: number;
  /** chunk size for random access requests (should be same as sqlite page size) */
  requestChunkSize: number;
  /** number of virtual read heads. default: 3 */
  maxReadHeads?: number;
  /** max read speed for sequential access. default: 5 MiB */
  maxReadSpeed?: number;
  /** if true, log all read pages into the `readPages` field for debugging */
  logPageReads?: boolean;
  /** if false, only cache read ahead chunks. default true, only set to false if you have your own cache. default true */
  cacheRequestedChunk?: boolean;
  /**  */
  progressCallback?: (e: HttpVfsProgressEvent) => void;
};
export type PageReadLog = {
  pageno: number;
  // if page was already loaded
  wasCached: boolean;
  // how many pages were prefetched
  prefetch: number;
  reason: string;
};
type ReadHead = { startChunk: number; speed: number };

function rangeArray(start: number, endInclusive: number) {
  return Array(endInclusive - start + 1)
    .fill(0)
    .map((_, i) => start + i);
}
export class LazyUint8Array {
  private serverChecked = false;
  private readonly chunks: Uint8Array[] = []; // Loaded chunks. Index is the chunk number
  totalFetchedBytes = 0;
  totalRequests = 0;
  readPages: PageReadLog[] = [];
  private _length?: number;

  // LRU list of read heds, max length = maxReadHeads. first is most recently used
  private readonly readHeads: ReadHead[] = [];
  private readonly _chunkSize: number;
  private readonly rangeMapper: RangeMapper;
  private readonly maxSpeed: number;
  private readonly maxReadHeads: number;
  private readonly logPageReads: boolean;
  private readonly cacheRequestedChunk: boolean;
  private readonly progressCallback?: (e: HttpVfsProgressEvent) => void;

  constructor(config: LazyFileConfig) {
    console.log("new lazy uint8array:", config);
    this._chunkSize = config.requestChunkSize;
    this.maxSpeed = Math.round(
      (config.maxReadSpeed || 5 * 1024 * 1024) / this._chunkSize
    ); // max 5MiB at once
    this.maxReadHeads = config.maxReadHeads ?? 3;
    this.rangeMapper = config.rangeMapper;
    this.logPageReads = config.logPageReads ?? false;
    this.progressCallback = config.progressCallback;
    if (config.fileLength) {
      this._length = config.fileLength;
    }
    this.cacheRequestedChunk = config.cacheRequestedChunk ?? true;
  }
  /**
   * efficiently copy the range [start, start + length) from the http file into the
   * output buffer at position [outOffset, outOffest + length)
   * reads from cache or synchronously fetches via HTTP if needed
   */
  async copyInto(
    buffer: Uint8Array,
    outOffset: number,
    length: number,
    start: number
  ): Promise<number> {
    if (start >= this.length) return 0;
    length = Math.min(this.length - start, length);
    const end = start + length;
    await this.ensureChunksCached(
      rangeArray((start / this.chunkSize) | 0, (end / this.chunkSize) | 0)
    );
    let i = 0;

    while (i < length) {
      // {idx: 24, chunkOffset: 24, chunkNum: 0, wantedSize: 16}
      const idx = start + i;
      const chunkOffset = idx % this.chunkSize;
      const chunkNum = (idx / this.chunkSize) | 0;
      const wantedSize = Math.min(this.chunkSize, end - idx);
      let inChunk = this.getChunk(chunkNum);
      if (chunkOffset !== 0 || wantedSize !== this.chunkSize) {
        inChunk = inChunk.subarray(chunkOffset, chunkOffset + wantedSize);
      }
      buffer.set(inChunk, outOffset + i);
      i += inChunk.length;
    }
    return length;
  }

  private lastGet = -1;
  /* find the best matching existing read head to get the given chunk or create a new one */
  private moveReadHead(wantedChunkNum: number): ReadHead {
    for (const [i, head] of this.readHeads.entries()) {
      const fetchStartChunkNum = head.startChunk + head.speed;
      const newSpeed = Math.min(this.maxSpeed, head.speed * 2);
      const wantedIsInNextFetchOfHead =
        wantedChunkNum >= fetchStartChunkNum &&
        wantedChunkNum < fetchStartChunkNum + newSpeed;
      if (wantedIsInNextFetchOfHead) {
        head.speed = newSpeed;
        head.startChunk = fetchStartChunkNum;
        if (i !== 0) {
          // move head to front
          this.readHeads.splice(i, 1);
          this.readHeads.unshift(head);
        }
        return head;
      }
    }
    const newHead: ReadHead = {
      startChunk: wantedChunkNum,
      speed: 1,
    };
    this.readHeads.unshift(newHead);
    while (this.readHeads.length > this.maxReadHeads) this.readHeads.pop();
    return newHead;
  }
  async ensureChunksCached(_chunkIds: number[]) {
    if (this.logPageReads) {
      for (const cid of _chunkIds) {
        if (typeof this.chunks[cid] !== "undefined") {
          this.readPages.push({
            pageno: cid,
            wasCached: true,
            prefetch: 0,
            reason: "[no tracking when cached]",
          });
        }
      }
    }
    const chunkIds = new Set(
      _chunkIds
        .filter((c) => typeof this.chunks[c] === "undefined")
        .sort((a, b) => a - b)
    );
    await this.fetchChunks([...chunkIds]);
  }

  // input: sorted list of chunk ids
  private async fetchChunks(wantedChunks: number[]) {
    if (wantedChunks.length === 0) return;
    const wantedChunkRanges: [number, number][] = [];
    const last = wantedChunks.slice(1).reduce<[number, number]>(
      ([start, end], current) => {
        if (end + 1 === current) {
          return [start, current];
        } else {
          wantedChunkRanges.push([start, end]);
          return [current, current];
        }
      },
      [wantedChunks[0], wantedChunks[0]]
    );
    wantedChunkRanges.push(last);

    const byteRanges: {
      chunks: [number, number];
      bytes: [number, number];
      lastChunkSize: number;
    }[] = [];
    for (const [wantedStartChunk, wantedEndChunk] of wantedChunkRanges) {
      const head = this.moveReadHead(wantedStartChunk);
      const newStartChunk = head.startChunk;
      const newEndChunk = Math.max(
        newStartChunk + head.speed - 1,
        wantedEndChunk
      );
      const startByte = newStartChunk * this.chunkSize;
      const wouldEndByte = (newEndChunk + 1) * this.chunkSize - 1; // including this byte
      const endByte = Math.min(wouldEndByte, this.length - 1); // if datalength-1 is selected, this is the last block
      const shorter = wouldEndByte - endByte;
      //console.log("WOLD", wouldEndByte, endByte, shorter, this.chunkSize - shorter)
      //console.log("RANGE", newStartChunk, newEndChunk, startByte, endByte);

      byteRanges.push({
        chunks: [newStartChunk, newEndChunk],
        bytes: [startByte, endByte],
        lastChunkSize: this.chunkSize - shorter,
      });
    }
    if (this.logPageReads) {
      // TODO: improve log fidelity
      const totalChunksFetched = byteRanges.reduce(
        (a, b) => a + b.chunks[1] - b.chunks[0] + 1,
        0
      );
      this.readPages.push({
        pageno: wantedChunkRanges[0][0],
        wasCached: false,
        prefetch: totalChunksFetched - 1,
        reason: "idk",
      });
    }
    const bufs = await this.doFetch(byteRanges.map((x) => x.bytes));
    // console.log(`xhr, got ${bufs.length} chunks`);
    for (const [rangeIdx, buf] of bufs.entries()) {
      let bufIndex = 0;
      const {
        chunks: [chunkStart, chunkEnd],
        lastChunkSize,
      } = byteRanges[rangeIdx];
      for (let curChunk = chunkStart; curChunk <= chunkEnd; curChunk++) {
        const curSize = curChunk === chunkEnd ? lastChunkSize : this.chunkSize;
        //console.log("CURS", curSize, lastChunkSize, this.chunkSize);
        const chunk = buf.subarray(bufIndex, bufIndex + curSize);
        bufIndex += curSize;
        this.chunks[curChunk] = chunk;
      }
      if (bufIndex !== buf.byteLength)
        throw Error(
          `left over response data? ${bufIndex} != ${buf.byteLength}`
        );
    }
  }
  /** get the given chunk from cache, throw if not cached */
  private getChunk(wantedChunkNum: number): Uint8Array {
    if (typeof this.chunks[wantedChunkNum] === "undefined") {
      throw Error(
        `chunk not cached? @${wantedChunkNum} ${this.rangeMapper(0, 1).url}`
      );
    } else {
      return this.chunks[wantedChunkNum];
    }
  }
  /** verify the server supports range requests and find out file length */
  private checkServer() {
    return true; // we assume server works / supports range requests + size is known for this
    var xhr = new XMLHttpRequest();
    const url = this.rangeMapper(0, 0).url;
    xhr.open("HEAD", url, false);
    xhr.setRequestHeader("Accept-Encoding", "identity");
    xhr.send(null);
    if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304))
      throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
    var datalength = Number(xhr.getResponseHeader("Content-length"));

    var hasByteServing = xhr.getResponseHeader("Accept-Ranges") === "bytes";
    var usesGzip = xhr.getResponseHeader("Content-Encoding") === "gzip";

    if (!hasByteServing) {
      const msg =
        "server either does not support byte serving or does not advertise it (`Accept-Ranges: bytes` header missing), or your database is hosted on CORS and the server doesn't mark the accept-ranges header as exposed.";
      console.warn(msg, "seen response headers:", xhr.getAllResponseHeaders());
      // throw Error(msg);
    }

    if (usesGzip || !datalength) {
      console.error("response headers", xhr.getAllResponseHeaders());
      throw Error("server uses gzip or doesn't have length");
    }

    if (!this._length) this._length = datalength;
    this.serverChecked = true;
  }
  get length() {
    if (!this.serverChecked) {
      try {
        this.checkServer();
      } catch (e) {
        console.error("checkServer", e);
        throw e;
      }
    }
    return this._length!;
  }

  get chunkSize() {
    if (!this.serverChecked) {
      this.checkServer();
    }
    return this._chunkSize!;
  }
  private async doFetch(
    ranges: [absoluteFrom: number, absoluteTo: number][]
  ): Promise<Uint8Array[]> {
    // console.log("doXHR", ranges);
    const reqs = new Map<string, [number, number][]>();

    for (const [from, to] of ranges) {
      this.totalFetchedBytes += to - from;
      if (to > this.length - 1)
        throw new Error(
          "only " + this.length + " bytes available! programmer error!"
        );
      const { fromByte, toByte, url } = this.rangeMapper(from, to);

      let r = reqs.get(url);
      if (!r) {
        r = [];
        reqs.set(url, r);
      }
      r.push([fromByte, toByte]);
    }
    this.totalRequests += reqs.size;
    if (reqs.size > 1) throw Error("chunk split currently not supported");

    for (const [url, ranges] of reqs) {
      const reqSize = ranges.reduce(
        (acc, [from, to]) => acc + to - from + 1,
        0
      );
      this.progressCallback?.({ fetchBytes: reqSize });
      console.log(
        `[xhr ${url.split("/").slice(-1)[0]} of ${reqSize / 1024} KiB]`
      );

      // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
      const headers = new Headers();
      if (this.length !== this.chunkSize)
        headers.set(
          "Range",
          "bytes=" + ranges.map(([from, to]) => `${from}-${to}`).join(", ")
        );

      const resp = await fetch(url, {
        headers,
      });
      if (!resp.ok)
        throw new Error("Couldn't load " + url + ". Status: " + resp.status);
      const buf = await resp.arrayBuffer();
      if (ranges.length > 1) {
        throw Error("not supported right now");
        /*return parseMultipartBuffer(
            buf,
            ranges.map(([from, to]) => to - from + 1)
          );*/
      } else {
        return [new Uint8Array(buf)];
      }
    }
    throw Error("no request??");
  }
  public getCachedChunks() {
    const chunks = [];
    for (let i in this.chunks) {
      chunks.push([+i, this.chunks[i]] as const);
    }
    return chunks;
  }
}
