import { AuthNeededError, AccessDeniedError, sleep } from "./utils";

// todo: make configurable
const HELPER_PROXY = "https://helper-proxy.webrecorder.workers.dev";


// ===========================================================================
function createLoader(url, headers, size, extra, blob) {
  if (url.startsWith("blob:")) {
    return new BlobLoader(url, blob, size);
  } else if (url.startsWith("http:") || url.startsWith("https:") || url.startsWith("file:")) {
    return new HttpRangeLoader(url, headers, size);
  } else if (url.startsWith("googledrive:")) {
    return new GoogleDriveLoader(url, headers, size, extra);
  } else {
    throw new Error("Invalid URL: " + url);
  }
}

// ===========================================================================
class HttpRangeLoader
{
  constructor(url, headers, length = null, canLoadOnDemand = false) {
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
  constructor(sourceUrl, headers, size, extra) {
    this.fileId = sourceUrl.slice("googledrive://".length);
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
      loader = new HttpRangeLoader(this.publicUrl, null, this.length);
      try {
        result = await loader.doInitialFetch(tryHead);
      } catch(e) {}


      if (!loader.isValid) {
        if (result && result.abort) {
          result.abort.abort();
        }

        if (await this.refreshPublicUrl()) {
          loader = new HttpRangeLoader(this.publicUrl, null, this.length);
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
      loader = new HttpRangeLoader(this.apiUrl, this.headers, this.length);
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
      loader = new HttpRangeLoader(this.publicUrl, null, this.length);

      try {
        return await loader.getRange(offset, length, streaming, signal);
      } catch (e) {
        if (await this.refreshPublicUrl()) {
          loader = new HttpRangeLoader(this.publicUrl, null, this.length);
          try {
            return await loader.getRange(offset, length, streaming, signal);
          } catch(e) {

          }
        }
      }

      //disable public mode?
      this.publicUrl = null;
    }

    loader = new HttpRangeLoader(this.apiUrl, this.headers, this.length);

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
class BlobLoader
{
  constructor(url, blob = null, size = null) {
    this.url = url;
    this.blob = blob;
    this.size = this.blob ? this.blob.size : size;

    // This is false since range-request/on-demand loading can initially be supported
    // blob urls are short-lived and can't be relied on in future sessions
    // Returning false ensures that the entire archive is buffered locally
    this.canLoadOnDemand = false;
  }

  get length() {
    return this.size;
  }

  get isValid() {
    return !!this.blob;
  }

  async doInitialFetch(tryHead) {
    if (!this.blob) {
      const response = await fetch(this.url);
      this.blob = await response.blob();
    }

    let stream = null;
    
    if (!tryHead) {
      stream = this.blob.stream ? this.blob.stream() : await this.getReadableStream(this.blob);
    }

    const response = new Response(stream);
    
    return {response, stream};
  }

  async getLength() {
    if (!this.blob && !this.blob.size) {
      let response = await fetch(this.url);
      this.blob = await response.blob();
      this.size = this.blob.size;
    }
    return this.size;
  }

  async getRange(offset, length, streaming = false, signal) {

    if (!this.blob) {
      const headers = new Headers();
      headers.set("Range", `bytes=${offset}-${offset + length - 1}`);

      const response = await fetch(this.url, {headers});

      // if a range was returned, just use that
      if (response.headers.get("content-range")) {
        if (streaming) {
          return response.body;
        } else {
          return new Uint8Array(await response.arrayBuffer());
        }
      }

      //otherwise, we need to store full blob, then slice
      this.blob = await response.blob();
    }

    const blobChunk = this.blob.slice(offset, offset + length, "application/octet-stream");

    if (streaming) {
      return blobChunk.stream ? blobChunk.stream() : await this.getReadableStream(blobChunk);
    } else {
      try {
        const ab = blobChunk.arrayBuffer ? await blobChunk.arrayBuffer() : await this.getArrayBuffer(blobChunk);
        return new Uint8Array(ab);
      } catch(e) {
        console.log("error reading blob", e);
        return null;
      }
    }
  }

  getArrayBuffer(blob) {
    return new Promise((resolve) => {
      let fr = new FileReader();
      fr.onloadend = () => {
        resolve(fr.result);
      };
      fr.readAsArrayBuffer(blob);
    });
  }

  async getReadableStream(blob) {
    const ab = await this.getArrayBuffer(blob);

    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(ab));
        controller.close();
      }
    });
  }
}

export { createLoader }