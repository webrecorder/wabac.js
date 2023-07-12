import { BaseAsyncIterReader, AsyncIterReader } from "warcio";
import { isNullBodyStatus, decodeLatin1, encodeLatin1, MAX_STREAM_CHUNK_SIZE, tsToDate } from "./utils.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();


// ===========================================================================
class ArchiveResponse
{

  static fromResponse({url, response, date, noRW, isLive}) {
    const payload = response.body ? new AsyncIterReader(response.body.getReader(), false) : null;
    const status = Number(response.headers.get("x-redirect-status") || response.status);
    const statusText = response.headers.get("x-redirect-statusText") || response.statusText;

    let headers = new Headers(response.headers);

    let origLoc = headers.get("x-orig-location");
    if (origLoc) {
      if (origLoc.startsWith(self.location.origin)) {
        origLoc = origLoc.slice(self.location.origin.length);
      }
      headers.set("location", origLoc);
      headers.delete("x-orig-location");
      headers.delete("x-redirect-status");
      headers.delete("x-redirect-statusText");
    }

    let updateTS = null;

    const origTs = headers.get("x-orig-ts");
    if (origTs) {
      date = tsToDate(origTs);
      headers.delete("x-orig-ts");

      // force TS update downstream
      if (origTs && origLoc) {
        updateTS = origTs;
      }
    }
    const mementoDt = headers.get("memento-datetime");
    if (mementoDt) {
      date = new Date(mementoDt);
    }

    const cookie = (headers.get("x-proxy-set-cookie"));
    if (cookie) {
      const cookies = [];
      cookie.split(",").forEach((c) => {
        const cval = c.split(";", 1)[0].trim();
        if (cval.indexOf("=") > 0) {
          cookies.push(cval);
        }
      });
      headers.delete("x-proxy-set-cookie");

      if (cookies.length) {
        headers.set("x-wabac-preset-cookie", cookies.join(";"));
        //console.log("cookies", cookies.join(";"));
      }
    }

    return new ArchiveResponse({payload, status, statusText, headers, url, date, noRW, isLive, updateTS});
  }

  constructor({payload, status, statusText, headers, url, date, extraOpts = null, noRW = false, isLive = false, updateTS = null}) {
    this.reader = null;
    this.buffer = null;

    if (payload && (payload[Symbol.asyncIterator] || payload instanceof BaseAsyncIterReader)) {
      this.reader = payload;
    } else {
      this.buffer = payload;
    }

    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.url = url;
    this.date = date;
    this.extraOpts = extraOpts;
    this.noRW = noRW;
    this.isLive = isLive;
    this.updateTS = updateTS;
  }

  async getText(isUTF8 = false) {
    const buff = await this.getBuffer();
    if (typeof(buff) === "string") {
      return buff;
    }

    return isUTF8 ? decoder.decode(buff) : decodeLatin1(buff);
  }

  setText(text, isUTF8 = false) {
    this.setBuffer(isUTF8 ? encoder.encode(text) : encodeLatin1(text));
  }

  async getBuffer() {
    if (this.buffer) {
      return this.buffer;
    }

    this.buffer = await this.reader.readFully();
    return this.buffer;
  }

  setBuffer(buffer) {
    this.buffer = buffer;
    this.reader = null;
  }

  setReader(reader) {
    if (reader instanceof BaseAsyncIterReader) {
      this.reader = reader;
      this.buffer = null;
    } else if (reader.getReader) {
      this.reader = new AsyncIterReader(reader.getReader());
      this.buffer = null;
    }
  }

  expectedLength() {
    if (this.buffer) {
      return this.buffer.length;
    } else if (this.reader && this.reader.reader) {
      return this.reader.reader.length;
    }
  }

  createIter() {
    const buffer = this.buffer;
    const reader = this.reader;

    async function* iter() {
      if (buffer) {
        for (let i = 0; i < buffer.length; i += MAX_STREAM_CHUNK_SIZE) {
          yield buffer.slice(i, i + MAX_STREAM_CHUNK_SIZE);
        }

      } else if (reader) {
        yield* reader;
      }
    }

    return iter();
  }

  async* [Symbol.asyncIterator]() {
    yield* this.createIter();
  }

  setRange(range) {
    if (this.status === 206) {
      const currRange = this.headers.get("Content-Range");
      if (currRange && !currRange.startsWith("bytes 0-")) {
        return false;
      }
    }

    const bytes = range.match(/^bytes=(\d+)-(\d+)?$/);

    let length = 0;

    if (this.buffer) {
      length = this.buffer.length;
    } else if (this.reader) {
      //length = this.reader.length;
      length = Number(this.headers.get("content-length"));

      // if length is not known, keep as 200
      if (!length) {
        return false;
      }
    }

    if (!bytes) {
      this.status = 416;
      this.statusText = "Range Not Satisfiable";
      this.headers.set("Content-Range", `*/${length}`);
      return false;
    }

    const start = Number(bytes[1]);
    const end = Number(bytes[2]) || (length - 1);

    if (this.buffer) {
      this.buffer = this.buffer.slice(start, end + 1);

    } else if (this.reader) {
      if (!this.reader.setLimitSkip) {
        return false;
      }
      if (start !== 0 || end !== (length - 1)) {
        this.reader.setLimitSkip(end - start + 1, start);
      } else if (this.reader.setRangeAll) {
        this.reader.setRangeAll(length);
      }
    }

    this.headers.set("Content-Range", `bytes ${start}-${end}/${length}`);
    this.headers.set("Content-Length", end - start + 1);

    this.status = 206;
    this.statusText = "Partial Content";

    return true;
  }

  makeResponse(coHeaders = false, overwriteDisposition = false) {
    let body = null;
    if (!isNullBodyStatus(this.status)) {
      body = this.buffer || !this.reader ? this.buffer : this.reader.getReadableStream();
    }

    const response = new Response(body, {status: this.status,
      statusText: this.statusText,
      headers: this.headers});
    response.date = this.date;
    if (coHeaders) {
      response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
      response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    }
    if (overwriteDisposition) {
      response.headers.set("content-disposition", "inline");
    }
    return response;
  }
}


export { ArchiveResponse };

