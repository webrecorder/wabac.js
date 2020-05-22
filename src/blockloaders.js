import { AuthNeededError } from "./utils";

// todo: make configurable
const HELPER_PROXY = "https://helper-proxy.webrecorder.workers.dev";


// ===========================================================================
function createLoader(url, headers, size, extra) {
  if (url.startsWith("blob:")) {
    return new BlobLoader(url, null, extra);
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
  constructor(url, headers, length = null, supportsRange = false) {
    this.url = url;
    this.headers = headers || {};
    this.length = length;
    this.supportsRange = supportsRange;
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
          this.supportsRange = (response.status === 206);
          this.isValid = true;
        }
      } catch(e) {

      }
    }

    if (!this.isValid) {
      abort = new AbortController();
      const signal = abort.signal;
      response = await fetch(this.url, {headers, signal});
      this.supportsRange = (response.status === 206);
      this.isValid = (response.status === 206 || response.status === 200);
    }

    if (this.length === null) {
      this.length = response.headers.get("Content-Length");
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
      if (resp.status === 401 || resp.status === 403) {
        throw new AuthNeededError(this.url, resp.status);
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
    return await loader.getRange(offset, length, streaming, signal);
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

  get supportsRange() {
    return true;
  }
}


// ===========================================================================
class BlobLoader
{
  constructor(url, blob = null) {
    this.url = url;
    this.blob = blob;
  }

  get supportsRange() {
    return false;
  }

  get length() {
    return (this.blob ? this.blob.size : 0);
  }

  get isValid() {
    return !!this.blob;
  }

  async doInitialFetch() {
    let response = await fetch(this.url);
    this.blob = await response.blob();

    const abort = new AbortController();
    const signal = abort.signal;
    response = await fetch(this.url, {signal});

    return {response, abort};
  }

  async getLength() {
    if (!this.blob) {
      let response = await fetch(this.url);
      this.blob = await response.blob();
    }
    return this.blob.size;
  }

  async getRange(offset, length, streaming = false, signal) {
    if (!this.blob) {
      await this.getLength();
    }

    const blobChunk = this.blob.slice(offset, offset + length, "application/octet-stream");

    if (streaming) {
      return blobChunk.stream ? blobChunk.stream() : this.getReadableStream(blobChunk);
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