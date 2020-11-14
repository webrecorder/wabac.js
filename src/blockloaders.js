import { AuthNeededError, AccessDeniedError, sleep } from "./utils";

import { AsyncIterReader } from 'warcio';

// todo: make configurable
const HELPER_PROXY = "https://helper-proxy.webrecorder.workers.dev";

const IPFS_CORE_JS = "https://cdn.jsdelivr.net/npm/ipfs-core@0.2.0/dist/index.min.js";


// ===========================================================================
function createLoader(opts) {
  const { url } = opts;

  if (url.startsWith("blob:")) {
    return new BlobCacheLoader(opts);
  } else if (url.startsWith("http:") || url.startsWith("https:") || url.startsWith("file:")) {
    return new HttpRangeLoader(opts);
  } else if (url.startsWith("googledrive:")) {
    return new GoogleDriveLoader(opts);
  } else if (url.startsWith("ipfs:")) {
    return new IPFSRangeLoader(opts);
  } else {
    throw new Error("Invalid URL: " + url);
  }
}

// ===========================================================================
class HttpRangeLoader
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
        response = await fetch(this.url, {headers, method: "HEAD"});
        if (response.status === 200 || response.status == 206) {
          this.canLoadOnDemand = ((response.status === 206) || response.headers.get("Accept-Ranges") === "bytes");
          this.isValid = true;
        }
      } catch(e) {

      }
    }

    if (!this.isValid) {
      abort = new AbortController();
      const signal = abort.signal;
      response = await fetch(this.url, {headers, signal});
      this.canLoadOnDemand = ((response.status === 206) || response.headers.get("Accept-Ranges") === "bytes");
      this.isValid = (response.status === 206 || response.status === 200);
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
      const {response, abort} = await this.doInitialFetch(true);
      if (abort) {
        abort.abort();
      }
    }
    return this.length;
  }

  async getRange(offset, length, streaming = false, signal = null) {
    const headers = new Headers(this.headers);
    headers.set("Range", `bytes=${offset}-${offset + length - 1}`);

    const options = {signal, headers};

    let resp = null;

    try {
      resp = await fetch(this.url, options);
    } catch(e) {
      console.log(e);
      throw new RangeError(this.url);
    }

    if (resp.status != 206) {
      if (resp.status === 401) {
        throw new AuthNeededError(this.url, resp.status);
      } else if (resp.status == 403) {
        throw new AccessDeniedError(this.url, resp);
      } else {
        throw new RangeError(this.url, resp.status);
      }
    }

    if (streaming) {
      return resp.body;
    } else {
      return new Uint8Array(await resp.arrayBuffer());
    }
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
      loader = new HttpRangeLoader({url: this.publicUrl, length: this.length});
      try {
        result = await loader.doInitialFetch(tryHead);
      } catch(e) {}


      if (!loader.isValid) {
        if (result && result.abort) {
          result.abort.abort();
        }

        if (await this.refreshPublicUrl()) {
          loader = new HttpRangeLoader({url: this.publicUrl, length: this.length});
          try {
            result = await loader.doInitialFetch(tryHead);
          } catch(e) {}

          if (!loader.isValid && result && result.abort) {
            result.abort.abort();
          }
        }
      }
    }

    if (!loader || !loader.isValid) {
      this.publicUrl = null;
      loader = new HttpRangeLoader({url: this.apiUrl, headers: this.headers, length: this.length});
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
      loader = new HttpRangeLoader({url: this.publicUrl, length: this.length});

      try {
        return await loader.getRange(offset, length, streaming, signal);
      } catch (e) {
        if (await this.refreshPublicUrl()) {
          loader = new HttpRangeLoader({url: this.publicUrl, length: this.length});
          try {
            return await loader.getRange(offset, length, streaming, signal);
          } catch(e) {

          }
        }
      }

      //disable public mode?
      this.publicUrl = null;
    }

    loader = new HttpRangeLoader({url: this.apiUrl, headers: this.headers, length: this.length});

    let backoff = 50;

    while (backoff < 2000) {
      try {
        return await loader.getRange(offset, length, streaming, signal);
      } catch(e) {
        if (e instanceof AccessDeniedError && e.resp.headers.get("content-type").startsWith("application/json")) {
          const err = await e.resp.json();
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
    if (!this.blob && !this.blob.size) {
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

    const response = new Response(tryHead ? null : this.arrayBuffer);

    const stream = tryHead ? null : this.getReadableStream(this.arrayBuffer);

    return {response, stream};
  }

  async getRange(offset, length, streaming = false, signal) {
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
let ipfs = null;
let initingIPFS = null;
let ipfsGC = null;

class IPFSRangeLoader
{
  static async doInitIPFS() {
    if (!self.IpfsCore) {
      const resp = await fetch(IPFS_CORE_JS);
      eval(await resp.text());
    }

    ipfs = await self.IpfsCore.create({
      init: {emptyRepo: true},
      //preload: {enabled: false},
    });
  }

  static async runGC() {
    let count = 0;

    for await (const res of ipfs.repo.gc()) {
      count++;
    }
    console.log(`IPFS GC, Removed ${count} blocks`);
  }

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

    this.httpFallback = new HttpRangeLoader({url: "https://ipfs.io/ipfs/" + this.cid});
  }

  async initIPFS() {
    if (!ipfs) {
      try {
        if (!initingIPFS) {
          initingIPFS = IPFSRangeLoader.doInitIPFS();
        }

        await initingIPFS;

      } catch (e) {
        console.warn(e);
      }
    }

    return ipfs;
  }

  async getLength() {
    if (this.httpFallback) {
      return await this.httpFallback.getLength();
    }

    return this.length;
  }

  async doInitialFetch(tryHead) {
    const ipfs = await this.initIPFS();

    let status = 206;

    try {
      for await (const file of ipfs.get(this.cid, {timeout: 20000, preload: false})) {
        this.length = file.size;
        this.isValid = (file.type === "file");
        break;
      }
    } catch (e) {
      console.warn(e);
      const res = await this.httpFallback.doInitialFetch(tryHead);
      this.length = this.httpFallback.length;
      this.isValid = this.httpFallback.isValid;
      return res;
    }

    if (!this.isValid) {
      status = 404;
    }

    const abort = new AbortController();
    let body;

    if (tryHead || !this.isValid) {
      body = new Uint8Array([]);
    } else {
      const stream = ipfs.cat(this.cid, {signal: abort.signal});
      body = this.getReadableStream(stream);
    }

    const response = new Response(body, {status});

    return {response, abort};
  }

  async getRange(offset, length, streaming = false, signal = null) {
    try {
      const ipfs = await this.initIPFS();

      const stream = ipfs.cat(this.cid, {offset, length, signal});

      if (ipfsGC) {
        clearInterval(ipfsGC);
      }
      ipfsGC = setInterval(IPFSRangeLoader.runGC, 120000);

      if (streaming) {
        return this.getReadableStream(stream);
      } else {
        const chunks = [];
        let size = 0;

        for await (const chunk of stream) {
          chunks.push(chunk);
          size += chunk.byteLength;
        }

        return AsyncIterReader.concatChunks(chunks, size);
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

export { createLoader }