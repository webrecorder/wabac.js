import { makeHeaders, tsToDate } from './utils.js';

import { Readable, Transform } from 'stream';
import { Inflate } from 'pako';

import { WARCStreamTransform } from 'node-warc';


// ===========================================================================
class WARCLoader {
  constructor(ab) {
    this.arraybuffer = ab;

    this.anyPages = false;

    this._lastRecord = null;

    //this.reader = new FileReader();
    this.warc = new WARCStreamTransform();

    this.rstream = new Readable();
    this.rstream._read = () => { };

    this.lastOffset = 0;

    this.offsets = [];
    this.recordCount = 0;
  }

  parseWarcInfo(record) {
    var dec = new TextDecoder("utf-8");
    const text = dec.decode(record.content);

    // Webrecorder-style metadata
    for (const line of text.split("\n")) {
      if (line.startsWith("json-metadata:")) {
        try {
          const json = JSON.parse(line.slice("json-metadata:".length));

          const pages = json.pages || [];

          for (const page of pages) {
            const url = page.url;
            const title = page.title || page.url;
            const id = page.id;
            const date = tsToDate(page.timestamp).toISOString();
            this.db.addPage({url, date, title, id});
            this.anyPages = true;
          }

        } catch (e) { }
      }
    }
  }

  index(record, cdx) {
    if (record.warcType === "warcinfo") {
      this.parseWarcInfo(record);
      return;
    }

    //record.cdx = cdx;

    if (!this._lastRecord) {
      this._lastRecord = record;
      return;
    }

    if (this._lastRecord.warcTargetURI != record.warcTargetURI) {
      this.indexReqResponse(this._lastRecord, null);
      this._lastRecord = record;
      return;
    }

    if (record.warcType === "request" && this._lastRecord.warcType === "response") {
      this.indexReqResponse(this._lastRecord, record);
    } else if (record.warcType === "response" && this._lastRecord.warcType === "request") {
      this.indexReqResponse(record, this._lastRecord);
    }
    this._lastRecord = null;
  }

  indexDone() {
    if (this._lastRecord) {
      this.indexReqResponse(this._lastRecord);
      this._lastRecord = null;
    }
  }

  indexError() {
    //todo: indicate partial parse?
    this.indexDone();
  }

  indexReqResponse(record, reqRecord) {
    if (record.warcType !== "response" && record.warcType !== "resource") {
      return;
    }

    const url = record.warcTargetURI.split("#")[0];
    const date = record.warcDate;

    let headers;
    let status = 200;
    let statusText = "OK";
    let content = record.content;
    let cl = 0;
    let mime = "";

    if (record.httpInfo) {
      try {
        status = parseInt(record.httpInfo.statusCode);
      } catch (e) {
      }

      // skip empty responses
      if (status === 204) {
        return;
      }

      if (reqRecord && reqRecord.httpInfo.method === "OPTIONS") {
        return;
      }
 
      statusText = record.httpInfo.statusReason;

      headers = makeHeaders(record.httpInfo.headers);

      if (!reqRecord && !record.content.length &&
          (headers.get("access-control-allow-methods") || headers.get("access-control-allow-credentials"))) {
        return;
      }

      mime = (headers.get("content-type") || "").split(";")[0];

      cl = parseInt(headers.get('content-length') || 0);

      // skip partial responses (not starting from 0)
      if (status === 206) {
        const range = headers.get("content-range");

        const fullRange = `bytes 0-${cl-1}/${cl}`;

        // only include 206 responses if they are the full range
        if (range && range !== fullRange) {
          return;
        }
      }

      // skip self-redirects
      if (status > 300 && status < 400) {
        const location = headers.get('location');
        if (location) {
          if (new URL(location, url).href === url) {
            return;
          }
        }
      }
    } else {
      headers = new Headers();
      headers.set("content-type", record.warcContentType);
      headers.set("content-length", record.warcContentLength);
      mime = record.warcContentType;

      cl = record.warcContentLength;
    }

    if (reqRecord && reqRecord.httpInfo.headers) {
      try {
        const reqHeaders = new Headers(reqRecord.httpInfo.headers);
        const cookie = reqHeaders.get("cookie");
        if (cookie) {
          headers.set("x-wabac-preset-cookie", cookie);
        }
      } catch(e) {
        console.warn(e);
      }
    }

    if (cl && content.byteLength !== cl) {
      // expected mismatch due to bug in node-warc occasionally including trailing \r\n in record
      if (cl === content.byteLength - 2) {
        content = content.slice(0, cl);
      } else {
      // otherwise, warn about mismatch
        console.warn(`CL mismatch for ${url}: expected: ${cl}, found: ${content.byteLength}`);
      }
    }

    // if no pages found, start detection if hasn't started already
    if (this.detectPages === undefined) {
      this.detectPages = !this.anyPages;
    }

    if (this.detectPages) {
      if (this.isPage(url, status, headers)) {
        const title = url;
        this.db.addPage({url, date, title});
      }
    }

    const ts = new Date(date).getTime();

    const respHeaders = Object.fromEntries(headers.entries());

    const entry = {url, ts, status, mime, respHeaders, payload: content}

    if (record.warcHeader["WARC-JSON-Metadata"]) {
      try {
        entry.extraOpts = JSON.parse(record.warcHeader["WARC-JSON-Metadata"]);
      } catch (e) { }
    }

    this.db.addResource(entry);
  }

  isPage(url, status, headers) {
    if (status != 200) {
      return false;
    }

    if (!url.startsWith("http:") && !url.startsWith("https:") && !url.startsWith("blob:")) {
      return false;
    }

    if (url.endsWith("/robots.txt")) {
      return false;
    }

    // skip urls with long query
    const parts = url.split("?", 2);

    if (parts.length === 2 && parts[1].length > parts[0].length) {
      return false;
    }

    // skip 'files' starting with '.' from being listed as pages
    if (parts[0].substring(parts[0].lastIndexOf("/") + 1).startsWith(".")) {
      return false;
    }

    let contentType = headers.get("Content-Type") || "";
    contentType = contentType.split(";", 1)[0];
    if (contentType !== "text/html") {
      return false;
    }

    return true;
  }

  load(db) {
    this.db = db;
    this.recordCount = 0;

    const buffer = new Uint8Array(this.arraybuffer);

    const isGzip = (buffer.length > 2 && buffer[0] == 0x1f && buffer[1] == 0x8b && buffer[2] == 0x08);

    if (isGzip) {
      return new Promise((resolve, reject) => {
        this.rstream.pipe(new DecompStream(this)).pipe(this.warc)
          .on('data', (record) => { this.index(record, this.offsets[this.recordCount++]) })
          .on('end', () => { this.indexDone(); resolve(); })
          .on('error', () => { this.indexError(); resolve(); });

        this.rstream.push(buffer);
        this.rstream.push(null);
      });
    } else {
      return new Promise((resolve, reject) => {
        this.rstream.pipe(this.warc)
          .on('data', (record) => { this.index(record, {}) })
          .on('end', () => { this.indexDone(); resolve(); })
          .on('error', () => { this.indexError(); resolve(); });

        this.rstream.push(buffer);
        this.rstream.push(null);
      });
    }
  }
}


// ===========================================================================
class DecompStream extends Transform {
  constructor(loader) {
    super();
    this.loader = loader;
  }

  _transform(buffer, encoding, done) {
    let strm, len, pos = 0;

    let lastPos = 0;
    let inflator;

    do {
      len = buffer.length - pos;

      const _in = new Uint8Array(buffer.buffer, pos, len);

      inflator = new Inflate();

      strm = inflator.strm;
      inflator.push(_in, true);

      this.push(inflator.result);

      lastPos = pos;
      pos += strm.next_in;

      this.loader.offsets.push({ "offset": lastPos, "length": pos - lastPos });

    } while (strm.avail_in);

    done();
  }

  _flush(done) {
    done()
  }
}



export { WARCLoader };
