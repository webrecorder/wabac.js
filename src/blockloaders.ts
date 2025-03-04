import { AuthNeededError, AccessDeniedError, RangeError, sleep } from "./utils";

import { initAutoIPFS } from "./ipfs";

import { concatChunks } from "warcio";

// todo: make configurable
const HELPER_PROXY = "https://helper-proxy.webrecorder.workers.dev";

export type ResponseAbort = {
  response: Response;
  abort: AbortController | null;
};

export type BlockLoaderExtra = {
  arrayBuffer?: Uint8Array;
  publicUrl?: string;
  fileHandle?: FileSystemFileHandle;
};

export type BlockLoaderOpts = {
  url: string;
  headers?: Record<string, string> | Headers;
  extra?: BlockLoaderExtra;
  size?: number;
  blob?: Blob;
};

// ===========================================================================
export async function createLoader(opts: BlockLoaderOpts): Promise<BaseLoader> {
  const { url } = opts;

  if (opts.extra?.arrayBuffer) {
    return new ArrayBufferLoader(opts.extra.arrayBuffer);
  }

  const scheme = url.split(":", 1)[0];

  // built-in loaders
  switch (scheme) {
    case "blob":
      return new BlobCacheLoader(opts);

    case "http":
    case "https":
      return new FetchRangeLoader(opts);

    case "file":
      return new FileHandleLoader(opts);

    case "googledrive":
      return new GoogleDriveLoader(opts);

    case "ipfs":
      return new IPFSRangeLoader(opts);
  }

  // if URL has same scheme as current origin, use regular http fetch
  try {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (self.location && scheme === self.location.protocol.split(":")[0]) {
      return new FetchRangeLoader(opts);
    }
  } catch (_) {
    // likely no self and self.location, so ignore
  }

  // see if the specified scheme is generally fetchable
  try {
    await fetch(`${scheme}://localhost`, { method: "HEAD" });
    // if reached here, scheme is supported, so use fetch loader
    return new FetchRangeLoader(opts);
  } catch (_) {
    // if raised exception, scheme not supported, don't use fetch loader
  }

  // custom provided loaders
  throw new Error("Invalid URL: " + url);
}

// ===========================================================================
export abstract class BaseLoader {
  canLoadOnDemand = true;
  headers: Record<string, string> | Headers = {};
  length: number | null = null;
  canDoNegativeRange = false;

  constructor(canLoadOnDemand: boolean) {
    this.canLoadOnDemand = canLoadOnDemand;
  }

  abstract doInitialFetch(
    tryHead: boolean,
    skipRange: boolean,
  ): Promise<ResponseAbort>;

  abstract getLength(): Promise<number>;

  abstract getRange(
    offset: number,
    length: number,
    streaming: boolean,
    signal?: AbortSignal | null,
  ): Promise<Uint8Array | ReadableStream<Uint8Array>>;

  abstract get isValid(): boolean;

  async getRangeFromEnd(
    length: number,
    streaming: boolean,
    signal?: AbortSignal | null,
  ): Promise<Uint8Array | ReadableStream<Uint8Array>> {
    if (!this.canDoNegativeRange) {
      const totalLength = await this.getLength();
      return await this.getRange(
        totalLength - length,
        length,
        streaming,
        signal,
      );
    } else {
      return await this.getRange(0, -length, streaming, signal);
    }
  }
}

// ===========================================================================
class FetchRangeLoader extends BaseLoader {
  url: string;
  override length: number | null;
  isValid = false;
  ipfsAPI = null;
  loadingIPFS = null;

  constructor({
    url,
    headers,
    length = null,
    canLoadOnDemand = false,
  }: {
    url: string;
    headers?: Record<string, string> | Headers;
    length?: number | null;
    canLoadOnDemand?: boolean;
  }) {
    super(canLoadOnDemand);

    this.url = url;
    this.headers = headers || {};
    this.length = length;
    this.canLoadOnDemand = canLoadOnDemand;
    this.canDoNegativeRange = true;
  }

  override async doInitialFetch(
    tryHead: boolean,
    skipRange = false,
  ): Promise<ResponseAbort> {
    const headers = new Headers(this.headers);
    if (!skipRange) {
      headers.set("Range", "bytes=0-");
    }

    this.isValid = false;
    let abort: AbortController | null = null;
    let response: Response | null = null;

    if (tryHead) {
      try {
        response = await this.retryFetch(this.url, {
          headers,
          method: "HEAD",
          cache: "no-store",
        });
        if (response.status === 200 || response.status == 206) {
          this.canLoadOnDemand =
            response.status === 206 ||
            response.headers.get("Accept-Ranges") === "bytes";
          this.isValid = true;
        }
      } catch (_) {
        // ignore fetch failure, considered invalid
      }
    }

    if (!this.isValid || !this.canLoadOnDemand) {
      abort = new AbortController();
      const signal = abort.signal;
      response = await this.retryFetch(this.url, {
        headers,
        signal,
        cache: "no-store",
      });
      this.canLoadOnDemand =
        response.status === 206 ||
        response.headers.get("Accept-Ranges") === "bytes";
      this.isValid = response.status === 206 || response.status === 200;

      // if emulating HEAD, abort here
      if (tryHead) {
        abort.abort();
        abort = null;
      }
    }

    if (this.length === null && response) {
      this.length = Number(response.headers.get("Content-Length"));
      if (!this.length && response.status === 206) {
        this.parseLengthFromContentRange(response.headers);
      }
    }

    if (this.length === null) {
      // attempt to get length via proxy
      try {
        const resp = await fetch(`${HELPER_PROXY}/c/${this.url}`);
        const json = await resp.json();
        if (json.size) {
          this.length = json.size;
        }
      } catch (e) {
        console.log("Error fetching from helper: " + e!.toString());
      }
    }

    this.length = Number(this.length || 0);

    return { response: response!, abort };
  }

  async getLength() {
    if (this.length === null) {
      const { abort } = await this.doInitialFetch(true);
      if (abort) {
        abort.abort();
      }
    }
    return this.length || 0;
  }

  async getRange(
    offset: number,
    length: number,
    streaming = false,
    signal: AbortSignal | null = null,
  ): Promise<Uint8Array | ReadableStream<Uint8Array>> {
    const headers = new Headers(this.headers);
    if (length < 0) {
      headers.set("Range", `bytes=${length}`);
    } else {
      headers.set("Range", `bytes=${offset}-${offset + length - 1}`);
    }

    const cache: RequestCache = "no-store";

    const options = { signal, headers, cache };

    let resp: Response;

    try {
      resp = await this.retryFetch(this.url, options);
    } catch (e) {
      console.log(e);
      throw new RangeError(this.url);
    }

    if (resp.status != 206) {
      if (length < 0) {
        // attempt to get full length and try non-negative range
        const totalLength = await this.getLength();
        return await this.getRange(
          totalLength + length,
          -length,
          streaming,
          signal,
        );
      }
      const info = { url: this.url, status: resp.status, resp };

      if (resp.status === 401) {
        throw new AuthNeededError(info);
      } else if (resp.status == 403) {
        throw new AccessDeniedError(info);
      } else {
        throw new RangeError(info);
      }
    }

    if (this.length === null) {
      this.parseLengthFromContentRange(resp.headers);
    }

    if (streaming) {
      return resp.body || new Uint8Array();
    } else {
      return new Uint8Array(await resp.arrayBuffer());
    }
  }

  async retryFetch(url: string, options: RequestInit): Promise<Response> {
    let backoff = 1000;
    for (let count = 0; count < 20; count++) {
      const resp = await fetch(url, options);
      if (resp.status !== 429 && resp.status !== 503) {
        return resp;
      }
      await sleep(backoff);
      backoff += 2000;
    }
    throw new Error("retryFetch failed");
  }

  parseLengthFromContentRange(headers: Headers) {
    const range = headers.get("Content-Range");
    if (range) {
      const rangeParts = range.split("/");
      if (rangeParts.length === 2) {
        // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
        this.length = parseInt(rangeParts[1]);
      }
    }
  }
}

// ===========================================================================
class GoogleDriveLoader extends BaseLoader {
  fileId: string;
  apiUrl: string;
  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'BaseLoader'.
  length: number;

  publicUrl: string | null = null;
  isValid = false;

  constructor({
    url,
    headers,
    size,
    extra,
  }: {
    url: string;
    headers?: Record<string, string> | Headers;
    size?: number;
    extra?: BlockLoaderExtra;
  }) {
    super(true);

    this.fileId = url.slice("googledrive://".length);
    this.apiUrl = `https://www.googleapis.com/drive/v3/files/${this.fileId}?alt=media`;

    this.headers = headers || {};
    if (extra?.publicUrl) {
      this.publicUrl = extra.publicUrl;
    }
    this.length = size || 0;
  }

  override async getLength(): Promise<number> {
    return this.length;
  }

  override async doInitialFetch(tryHead: boolean): Promise<ResponseAbort> {
    let loader: FetchRangeLoader | null = null;
    let result: ResponseAbort | null = null;

    if (this.publicUrl) {
      loader = new FetchRangeLoader({
        url: this.publicUrl,
        length: this.length,
      });
      try {
        result = await loader.doInitialFetch(tryHead);
      } catch (_) {
        // catch and ignore, considered invalid
      }

      if (!loader.isValid) {
        if (result?.abort) {
          result.abort.abort();
        }

        if (await this.refreshPublicUrl()) {
          loader = new FetchRangeLoader({
            url: this.publicUrl,
            length: this.length,
          });
          try {
            result = await loader.doInitialFetch(tryHead);
          } catch (_) {
            // catch and ignore, considered invalid
          }
          if (!loader.isValid && result?.abort) {
            result.abort.abort();
          }
        }
      }
    }

    if (!loader?.isValid) {
      this.publicUrl = null;
      loader = new FetchRangeLoader({
        url: this.apiUrl,
        headers: this.headers,
        length: this.length,
      });
      result = await loader.doInitialFetch(tryHead);
    }

    this.isValid = loader.isValid;
    if (!this.length && loader.length) {
      this.length = loader.length;
    }
    return result!;
  }

  async getRange(
    offset: number,
    length: number,
    streaming = false,
    signal: AbortSignal,
  ) {
    let loader: FetchRangeLoader | null = null;

    if (this.publicUrl) {
      loader = new FetchRangeLoader({
        url: this.publicUrl,
        length: this.length,
      });

      try {
        return await loader.getRange(offset, length, streaming, signal);
      } catch (_) {
        if (await this.refreshPublicUrl()) {
          loader = new FetchRangeLoader({
            url: this.publicUrl,
            length: this.length,
          });
          try {
            return await loader.getRange(offset, length, streaming, signal);
          } catch (_) {
            // ignore fetch failure, considered invalid
          }
        }
      }

      //disable public mode?
      this.publicUrl = null;
    }

    loader = new FetchRangeLoader({
      url: this.apiUrl,
      headers: this.headers,
      length: this.length,
    });

    let backoff = 50;

    while (backoff < 2000) {
      try {
        return await loader.getRange(offset, length, streaming, signal);
      } catch (e) {
        if (
          e instanceof AccessDeniedError &&
          e.info["resp"]?.headers
            .get("content-type")
            .startsWith("application/json")
        ) {
          const err = await e.info["resp"].json();
          if (
            err.error?.errors &&
            err.error.errors[0].reason === "userRateLimitExceeded"
          ) {
            console.log(`Exponential backoff, waiting for: ${backoff}`);
            await sleep(backoff);
            backoff *= 2;
            continue;
          }
        }
        throw e;
      }
    }

    throw new RangeError("not found");
  }

  async refreshPublicUrl() {
    try {
      const resp = await fetch(`${HELPER_PROXY}/g/${this.fileId}`);
      const json = await resp.json();
      if (json.url) {
        this.publicUrl = json.url;
        return true;
      }
    } catch (_) {
      // ignore, return false
    }

    return false;
  }
}

// ===========================================================================
class ArrayBufferLoader extends BaseLoader {
  arrayBuffer: Uint8Array;
  size: number;

  constructor(arrayBuffer: Uint8Array) {
    super(true);

    this.arrayBuffer = arrayBuffer;
    this.size = arrayBuffer.length;
    this.length = this.size;
  }

  get isValid() {
    return !!this.arrayBuffer;
  }

  override async getLength() {
    return this.size;
  }

  override async doInitialFetch(tryHead = false): Promise<ResponseAbort> {
    const stream = tryHead
      ? null
      : getReadableStreamFromArray(this.arrayBuffer);

    const response = new Response(stream);

    return { response, abort: null };
  }

  async getRange(
    offset: number,
    length: number,
    streaming = false /*, signal*/,
  ) {
    const range = this.arrayBuffer.slice(offset, offset + length);

    return streaming ? getReadableStreamFromArray(range) : range;
  }
}

// ===========================================================================
class BlobCacheLoader extends BaseLoader {
  url: string;
  blob: Blob | null;
  size: number;
  arrayBuffer: Uint8Array | null = null;

  constructor({
    url,
    blob = null,
    size = null,
  }: {
    url: string;
    blob?: Blob | null;
    size?: number | null;
  }) {
    super(true);
    this.url = url;
    this.blob = blob;
    this.size = this.blob ? this.blob.size : size || 0;
    this.length = this.size;
  }

  get isValid() {
    return !!this.blob;
  }

  override async getLength() {
    if (!this.blob?.size) {
      const response = await fetch(this.url);
      this.blob = await response.blob();
      this.size = this.blob.size;
      this.length = this.size;
    }
    return this.size;
  }

  override async doInitialFetch(tryHead = false): Promise<ResponseAbort> {
    if (!this.blob) {
      try {
        const response = await fetch(this.url);
        this.blob = await response.blob();
        this.size = this.blob.size;
        this.length = this.size;
      } catch (e) {
        console.warn(e);
        throw e;
      }
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const arrayBuffer = this.blob.arrayBuffer
      ? await this.blob.arrayBuffer()
      : await this._getArrayBuffer();
    this.arrayBuffer = new Uint8Array(arrayBuffer);

    const stream = tryHead
      ? null
      : getReadableStreamFromArray(this.arrayBuffer);

    const response = new Response(stream);

    return { response, abort: null };
  }

  async getRange(
    offset: number,
    length: number,
    streaming = false /*, signal*/,
  ) {
    if (!this.arrayBuffer) {
      await this.doInitialFetch(true);
    }

    const range = this.arrayBuffer!.slice(offset, offset + length);

    return streaming ? getReadableStreamFromArray(range) : range;
  }

  async _getArrayBuffer(): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => {
        if (fr.result instanceof ArrayBuffer) {
          resolve(fr.result);
        } else {
          reject(fr.result);
        }
      };
      if (this.blob) {
        fr.readAsArrayBuffer(this.blob);
      }
    });
  }
}

// ===========================================================================
class FileHandleLoader extends BaseLoader {
  url: string;
  file: Blob | null;
  size?: number;
  fileHandle: FileSystemFileHandle;

  constructor({
    blob,
    size,
    extra,
    url,
  }: {
    blob?: Blob | null;
    size?: number;
    extra?: BlockLoaderExtra;
    url: string;
  }) {
    super(true);

    this.url = url;
    this.file = null;
    this.size = blob ? blob.size : size || 0;
    this.length = this.size;

    this.fileHandle = extra!.fileHandle!;
  }

  get isValid() {
    return !!this.file;
  }

  override async getLength(): Promise<number> {
    if (this.size === undefined) {
      await this.initFileObject();
    }
    return this.size!;
  }

  async initFileObject() {
    const options: FileSystemHandlePermissionDescriptor = { mode: "read" };

    const curr = await this.fileHandle.queryPermission(options);

    if (curr !== "granted") {
      const requested = await this.fileHandle.requestPermission(options);

      if (requested !== "granted") {
        throw new AuthNeededError({ fileHandle: this.fileHandle });
      }
    }

    this.file = await this.fileHandle.getFile();
    this.size = this.file.size;
    this.length = this.size;
  }

  override async doInitialFetch(tryHead = false): Promise<ResponseAbort> {
    if (!this.file) {
      await this.initFileObject();
    }

    const stream = tryHead ? null : this.file!.stream();

    const response = new Response(stream);

    return { response, abort: null };
  }

  async getRange(
    offset: number,
    length: number,
    streaming = false /*, signal*/,
  ) {
    if (!this.file) {
      await this.initFileObject();
    }

    const fileSlice = this.file!.slice(offset, offset + length);

    return streaming
      ? fileSlice.stream()
      : new Uint8Array(await fileSlice.arrayBuffer());
  }
}

// ===========================================================================
class IPFSRangeLoader extends BaseLoader {
  url: string;
  opts: Omit<BlockLoaderOpts, "url">;
  override length: number | null;
  isValid = false;

  constructor({ url, headers, ...opts }: BlockLoaderOpts) {
    super(true);

    this.url = url;
    this.opts = opts;

    // let inx = url.lastIndexOf("#");
    // if (inx < 0) {
    //   inx = undefined;
    // }

    this.headers = headers || {};
    this.length = null;
  }

  override async getLength(): Promise<number> {
    if (this.length === null) {
      await this.doInitialFetch(true);
    }

    return this.length!;
  }

  override async doInitialFetch(tryHead: boolean): Promise<ResponseAbort> {
    const autoipfsClient = await initAutoIPFS(this.opts);

    try {
      this.length = await autoipfsClient.getSize(this.url);
      this.isValid = this.length !== null;
    } catch (e) {
      console.warn(e);
      this.length = null;
      this.isValid = false;
    }

    let status = 206;

    if (!this.isValid) {
      status = 404;
    }

    const abort = new AbortController();
    const signal = abort.signal;
    let body;

    if (tryHead || !this.isValid) {
      body = new Uint8Array([]);
    } else {
      const iter = autoipfsClient.get(this.url, {
        signal,
      });
      body = getReadableStreamFromIter(iter);
    }

    const response = new Response(body, { status });

    return { response, abort };
  }

  async getRange(
    offset: number,
    length: number,
    streaming = false,
    signal: AbortSignal | null = null,
  ) {
    const autoipfsClient = await initAutoIPFS(this.opts);

    const iter = autoipfsClient.get(this.url, {
      start: offset,
      end: offset + length - 1,
      signal,
    });

    if (streaming) {
      return getReadableStreamFromIter(iter);
    } else {
      const chunks: Uint8Array[] = [];
      let size = 0;

      for await (const chunk of iter) {
        chunks.push(chunk);
        size += chunk.byteLength;
      }

      return concatChunks(chunks, size);
    }
  }
}

export function getReadableStreamFromIter(stream: AsyncIterable<Uint8Array>) {
  return new ReadableStream({
    start: async (controller) => {
      try {
        for await (const chunk of stream) {
          controller.enqueue(chunk);
        }
      } catch (e) {
        console.log(e);
      }
      controller.close();
    },
  });
}

export function getReadableStreamFromArray(array: Uint8Array) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(array);
      controller.close();
    },
  });
}
