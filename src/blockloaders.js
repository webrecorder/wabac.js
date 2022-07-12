import { AuthNeededError, AccessDeniedError, RangeError, sleep } from "./utils";

import { concatChunks } from "warcio";
import { initIPFS } from "./ipfs";

// todo: make configurable
const HELPER_PROXY = "https://helper-proxy.webrecorder.workers.dev";


// ===========================================================================
async function createLoader(opts) {
  const { url } = opts;

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
  }

  // if URL has same scheme as current origin, use regular http fetch
  try {
    if (self.location && scheme === self.location.protocol.split(":")[0]) {
      return new FetchRangeLoader(opts);
    }
  } catch (e) {
    // likely no self and self.location, so ignore
  }

  // see if the specified scheme is generally fetchable
  try {
    await fetch(`${scheme}://localhost`, {method: "HEAD"});
    // if reached here, scheme is supported, so use fetch loader
    return new FetchRangeLoader(opts);
  } catch (e) {
    // if raised exception, scheme not supported, don't use fetch loader
  }

  // custom provided loaders
  switch (scheme) {
  case "ipfs":
    return new IPFSRangeLoader(opts);

  default:
    throw new Error("Invalid URL: " + url);
  }
}

// ===========================================================================
class FetchRangeLoader
{
  constructor({url, headers, length = null, canLoadOnDemand = false}) {
    this.url = url;
    this.headers = headers || {};
    this.length = length;
    this.canLoadOnDemand = canLoadOnDemand;
    this.isValid = false;
  }

  async doInitialFetch(tryHead) {
    const headers = new Headers(this.headers);
    headers.set("Range", "bytes=0-");

    this.isValid = false;
    let abort = null;
    let response = null;

    if (tryHead) {
      try {
        response = await this.retryFetch(this.url, {headers, method: "HEAD", cache: "no-store"});
        if (response.status === 200 || response.status == 206) {
          this.canLoadOnDemand = ((response.status === 206) || response.headers.get("Accept-Ranges") === "bytes");
          this.isValid = true;
        }
      } catch (e) {
        // ignore fetch failure, considered invalid
      }
    }

    if (!this.isValid || !this.canLoadOnDemand) {
      abort = new AbortController();
      const signal = abort.signal;
      response = await this.retryFetch(this.url, {headers, signal, cache: "no-store"});
      this.canLoadOnDemand = ((response.status === 206) || response.headers.get("Accept-Ranges") === "bytes");
      this.isValid = (response.status === 206 || response.status === 200);

      // if emulating HEAD, abort here
      if (tryHead) {
        abort.abort();
        abort = null;
      }
    }

    if (this.length === null) {
      this.length = Number(response.headers.get("Content-Length"));
      if (!this.length && response.status === 206) {
        let range = response.headers.get("Content-Range");
        if (range) {
          range = range.split("/");
          if (range.length === 2){
            this.length = range[1];
          }
        }
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
        console.log("Error fetching from helper: " + e.toString());
      }
    }
    
    this.length = Number(this.length || 0);

    return {response, abort};
  }

  async getLength() {
    if (this.length === null) {
      const {abort} = await this.doInitialFetch(true);
      if (abort) {
        abort.abort();
      }
    }
    return this.length;
  }

  async getRange(offset, length, streaming = false, signal = null) {
    const headers = new Headers(this.headers);
    headers.set("Range", `bytes=${offset}-${offset + length - 1}`);

    const cache = "no-store";

    const options = {signal, headers, cache};

    let resp = null;

    try {
      resp = await this.retryFetch(this.url, options);
    } catch(e) {
      console.log(e);
      throw new RangeError(this.url);
    }

    if (resp.status != 206) {
      const info = {url: this.url, status: resp.status, resp};

      if (resp.status === 401) {
        throw new AuthNeededError(info);
      } else if (resp.status == 403) {
        throw new AccessDeniedError(info);
      } else {
        throw new RangeError(info);
      }
    }

    if (streaming) {
      return resp.body;
    } else {
      return new Uint8Array(await resp.arrayBuffer());
    }
  }

  async retryFetch(url, options) {
    let resp = null;
    let backoff = 1000;
    for (let count = 0; count < 20; count++) {
      resp = await fetch(url, options);
      if (resp.status !== 429) {
        break;
      }
      await sleep(backoff);
      backoff += 2000;
    }
    return resp;
  }
}

// ===========================================================================
class GoogleDriveLoader
{
  constructor({url, headers, size, extra}) {
    this.fileId = url.slice("googledrive://".length);
    this.apiUrl = `https://www.googleapis.com/drive/v3/files/${this.fileId}?alt=media`;
    this.canLoadOnDemand = true;

    this.headers = headers;
    if (extra && extra.publicUrl) {
      this.publicUrl = extra.publicUrl;
    } else {
      this.publicUrl = null;
    }
    this.length = size;
    this.isValid = false;
  }

  async getLength() {
    return this.length;
  }

  async doInitialFetch(tryHead) {
    let loader = null;
    let result = null;

    if (this.publicUrl) {
      loader = new FetchRangeLoader({url: this.publicUrl, length: this.length});
      try {
        result = await loader.doInitialFetch(tryHead);
      } catch(e) {
        // catch and ignore, considered invalid
      }

      if (!loader.isValid) {
        if (result && result.abort) {
          result.abort.abort();
        }

        if (await this.refreshPublicUrl()) {
          loader = new FetchRangeLoader({url: this.publicUrl, length: this.length});
          try {
            result = await loader.doInitialFetch(tryHead);
          } catch(e) {
            // catch and ignore, considered invalid
          }

          if (!loader.isValid && result && result.abort) {
            result.abort.abort();
          }
        }
      }
    }

    if (!loader || !loader.isValid) {
      this.publicUrl = null;
      loader = new FetchRangeLoader({url: this.apiUrl, headers: this.headers, length: this.length});
      result = await loader.doInitialFetch(tryHead);
    }

    this.isValid = loader.isValid;
    if (!this.length) {
      this.length = loader.length;
    }
    return result;
  }

  async getRange(offset, length, streaming = false, signal) {
    let loader = null;

    if (this.publicUrl) {
      loader = new FetchRangeLoader({url: this.publicUrl, length: this.length});

      try {
        return await loader.getRange(offset, length, streaming, signal);
      } catch (e) {
        if (await this.refreshPublicUrl()) {
          loader = new FetchRangeLoader({url: this.publicUrl, length: this.length});
          try {
            return await loader.getRange(offset, length, streaming, signal);
          } catch (e) {
            // ignore fetch failure, considered invalid
          }
        }
      }

      //disable public mode?
      this.publicUrl = null;
    }

    loader = new FetchRangeLoader({url: this.apiUrl, headers: this.headers, length: this.length});

    let backoff = 50;

    while (backoff < 2000) {
      try {
        return await loader.getRange(offset, length, streaming, signal);
      } catch(e) {
        if ((e instanceof AccessDeniedError) &&
            e.info && e.info.resp && e.info.resp.headers.get("content-type").
          startsWith("application/json")) {
          const err = await e.info.resp.json();
          if (err.error && err.error.errors && err.error.errors[0].reason === "userRateLimitExceeded") {
            console.log(`Exponential backoff, waiting for: ${backoff}`);
            await sleep(backoff);
            backoff *= 2;
            continue;
          }
        }
        throw e;
      }
    }
  }

  async refreshPublicUrl() {
    try {
      const resp = await fetch(`${HELPER_PROXY}/g/${this.fileId}`);
      const json = await resp.json();
      if (json.url) {
        this.publicUrl = json.url;
        return true;
      }
    } catch (e) {
      // ignore, return false
    }

    return false;
  }
}


// ===========================================================================
class BlobCacheLoader
{
  constructor({url, blob = null, size = null, extra = null}) {
    this.url = url;
    this.blob = blob;
    this.size = this.blob ? this.blob.size : size;

    this.arrayBuffer = extra && extra.arrayBuffer || null;

    this.canLoadOnDemand = true;
  }

  get length() {
    return this.size;
  }

  get isValid() {
    return !!this.blob;
  }

  async getLength() {
    if (!this.blob || !this.blob.size) {
      let response = await fetch(this.url);
      this.blob = await response.blob();
      this.size = this.blob.size;
    }
    return this.size;
  }

  async doInitialFetch(tryHead = false) {
    if (!this.blob) {
      try {
        const response = await fetch(this.url);
        this.blob = await response.blob();
      } catch (e) {
        console.warn(e);
        throw e;
      }
    }

    this.arrayBuffer = this.blob.arrayBuffer ? await this.blob.arrayBuffer() : await this.getArrayBuffer();
    this.arrayBuffer = new Uint8Array(this.arrayBuffer);

    const stream = tryHead ? null : this.getReadableStream(this.arrayBuffer);

    const response = new Response(stream);

    return {response};
  }

  async getRange(offset, length, streaming = false/*, signal*/) {
    if (!this.arrayBuffer) {
      await this.doInitialFetch(true);
    }

    const range = this.arrayBuffer.slice(offset, offset + length);

    return streaming ? this.getReadableStream(range) : range;
  }

  getArrayBuffer() {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => {
        resolve(fr.result);
      };
      fr.readAsArrayBuffer(this.blob);
    });
  }

  getReadableStream(array) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(array);
        controller.close();
      }
    });
  }
}

// ===========================================================================
class FileHandleLoader
{
  constructor({blob, size, extra, url})
  {
    this.url = url;
    this.file = blob;
    this.size = this.blob ? this.blob.size : size;

    this.fileHandle = extra.fileHandle;

    this.canLoadOnDemand = true;
  }

  get length() {
    return this.size;
  }

  get isValid() {
    return !!this.file;
  }

  async getLength() {
    if (this.size === undefined) {
      await this.initFileObject();
    }
    return this.size;
  }

  async initFileObject() {
    const options = {mode: "read"};

    const curr = await this.fileHandle.queryPermission(options);

    if (curr !== "granted") {
      const requested = await this.fileHandle.requestPermission(options);

      if (requested !== "granted") {
        throw new AuthNeededError({fileHandle: this.fileHandle});
      }
    }

    this.file = await this.fileHandle.getFile();
    this.size = this.file.size;
  }

  async doInitialFetch(tryHead = false) {
    if (!this.file) {
      await this.initFileObject();
    }

    const stream = tryHead ? null : this.file.stream();

    const response = new Response(stream);

    return {response};
  }

  async getRange(offset, length, streaming = false/*, signal*/) {
    if (!this.file) {
      await this.initFileObject();
    }

    const fileSlice = this.file.slice(offset, offset + length);

    return streaming ? fileSlice.stream() : new Uint8Array(await fileSlice.arrayBuffer());
  }
}

// ===========================================================================
class IPFSRangeLoader
{
  constructor({url, headers}) {
    this.url = url;

    let inx = url.lastIndexOf("#");
    if (inx < 0) {
      inx = undefined;
    }

    this.cid = this.url.slice("ipfs://".length, inx);

    this.headers = headers;
    this.length = null;
    this.canLoadOnDemand = true;

    this.httpFallback = new FetchRangeLoader({url: "https://ipfs.io/ipfs/" + this.cid});
  }

  async getLength() {
    if (this.length === null) {
      await this.doInitialFetch(true);
    }

    return this.length;
  }

  async doInitialFetch(tryHead) {
    const ipfsClient = await initIPFS();

    try {
      this.length = await ipfsClient.getFileSize(this.cid);
      this.isValid = (this.length !== null);

    } catch (e) {
      console.warn(e);
      const res = await this.httpFallback.doInitialFetch(tryHead);
      this.length = this.httpFallback.length;
      this.isValid = this.httpFallback.isValid;
      return res;
    }

    let status = 206;

    if (!this.isValid) {
      status = 404;
    }

    const abort = new AbortController();
    let body;

    if (tryHead || !this.isValid) {
      body = new Uint8Array([]);
    } else {
      const iter = await ipfsClient.cat(this.cid, {signal: abort.signal});
      body = this.getReadableStream(iter);
    }

    const response = new Response(body, {status});

    return {response, abort};
  }

  async getRange(offset, length, streaming = false, signal = null) {
    try {
      const ipfsClient = await initIPFS();

      const iter = await ipfsClient.cat(this.cid, {offset, length, signal});

      if (streaming) {
        return this.getReadableStream(iter);
      } else {
        const chunks = [];
        let size = 0;

        for await (const chunk of iter) {
          chunks.push(chunk);
          size += chunk.byteLength;
        }

        return concatChunks(chunks, size);
      }
    } catch (e) {
      return await this.httpFallback.getRange(offset, length, streaming, signal);
    }
  }

  getReadableStream(stream) {
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
      }
    });
  }
}

export { createLoader };
