import { BaseAsyncIterReader, AsyncIterReader } from 'warcio';
import { isNullBodyStatus, decodeLatin1 } from './utils';


class ArchiveResponse
{

  static fromResponse({url, response, date, noRW, isLive}) {
    const payload = response.body ? new AsyncIterReader(response.body.getReader(), false) : null;
    const status = Number(response.headers.get("x-redirect-status") || response.status);
    const statusText = response.headers.get("x-redirect-statusText") || response.statusText;

    let headers = new Headers(response.headers);

    const origLoc = headers.get("x-orig-location");
    if (origLoc) {
      headers.set("location", origLoc);
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

      if (cookies.length) {
        headers.set("x-wabac-preset-cookie", cookies.join(";"));
        console.log("cookies", cookies.join(";"));
      }
    }

    return new ArchiveResponse({payload, status, statusText, headers, url, date, noRW, isLive});
  }

  constructor({payload, status, statusText, headers, url, date, extraOpts = null, noRW = false, isLive = false}) {
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
  }

  async getText() {
    const buff = await this.getBuffer();
    return typeof(buff) === "string" ? buff : decodeLatin1(buff);
  }

  async getBuffer() {
    if (this.buffer) {
      return this.buffer;
    }

    this.buffer = await this.reader.readFully();
    return this.buffer;
  }

  async setContent(content) {
    if (content instanceof BaseAsyncIterReader) {
      this.reader = content;
      this.buffer = null;
    } else if (content.getReader) {
      this.reader = new AsyncIterReader(content.getReader());
      this.buffer = null;
    } else {
      this.reader = null;
      this.buffer = content;
    }
  }

  async* [Symbol.asyncIterator]() {
    if (this.buffer) {
      yield this.buffer;
    } else if (this.reader) {
      yield* this.reader;
    }
  }

  setRange(range) {
    const bytes = range.match(/^bytes\=(\d+)\-(\d+)?$/);

    let length = 0;

    if (this.buffer) {
      length = this.buffer.length;
    } else if (this.reader) {
      //length = this.reader.length;
      length = Number(this.headers.get("content-length"));

      // if length is not known, keep as 200
      if (!length) {
        return;
      }
    }

    if (!bytes) {
      this.status = 416;
      this.statusText = 'Range Not Satisfiable';
      this.headers.set('Content-Range', `*/${length}`);
      return false;
    }

    const start = Number(bytes[1]);
    const end = Number(bytes[2]) || (length - 1);

    if (this.buffer) {
      this.buffer = this.buffer.slice(start, end + 1);

    } else if (this.reader) {
      if (start !== 0 || end !== (length - 1)) {
        this.reader.setLimitSkip(end - start + 1, start);
      } else if (this.reader.setRangeAll) {
        this.reader.setRangeAll(length);
      }
    }

    this.headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
    this.headers.set('Content-Length', end - start + 1);

    this.status = 206;
    this.statusText = 'Partial Content';

    return true;
  }

  makeResponse(coHeaders = false) {
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
    return response;
  }
}


export { ArchiveResponse };

