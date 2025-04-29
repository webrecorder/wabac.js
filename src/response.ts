import { BaseAsyncIterReader, AsyncIterReader } from "warcio";
import {
  isNullBodyStatus,
  decodeLatin1,
  encodeLatin1,
  MAX_STREAM_CHUNK_SIZE,
  tsToDate,
  getStatusText,
  INITIAL_STREAM_CHUNK_SIZE,
} from "./utils";
import { Buffer } from "buffer";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type ArchiveResponseOpts = {
  payload: BaseAsyncIterReader | Uint8Array | null;
  status: number;
  statusText?: string;
  headers: Headers;
  url: string;
  date: Date;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraOpts?: Record<string, any> | null;
  noRW?: boolean;
  isLive?: boolean;
  updateTS?: string | null;
};

// ===========================================================================
class ArchiveResponse {
  static fromResponse({
    url,
    response,
    date,
    noRW,
    isLive,
    archivePrefix,
  }: {
    url: string;
    response: Response;
    date: Date;
    noRW?: boolean;
    isLive?: boolean;
    archivePrefix?: string;
  }) {
    const payload = response.body
      ? new AsyncIterReader(response.body.getReader(), null, false)
      : null;
    const status = Number(
      response.headers.get("x-redirect-status") || response.status,
    );
    const statusText =
      response.headers.get("x-redirect-statusText") || response.statusText;

    const headers = new Headers(response.headers);

    let origLoc = headers.get("x-orig-location");
    if (origLoc) {
      if (origLoc.startsWith(self.location.origin)) {
        origLoc = origLoc.slice(self.location.origin.length);
      }
      if (archivePrefix && origLoc.startsWith(archivePrefix)) {
        const inx = origLoc.indexOf("/http");
        if (inx > 0) {
          origLoc = origLoc.slice(inx + 1);
        }
      }
      headers.set("location", origLoc);
      headers.delete("x-orig-location");
      headers.delete("x-redirect-status");
      headers.delete("x-redirect-statusText");
    }

    let updateTS: string | null = null;

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

    const cookie = headers.get("x-proxy-set-cookie");
    if (cookie) {
      const cookies: string[] = [];
      cookie.split(",").forEach((c) => {
        // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
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

    return new ArchiveResponse({
      payload,
      status,
      statusText,
      headers,
      url,
      date,
      noRW,
      isLive,
      updateTS,
    });
  }

  reader: BaseAsyncIterReader | null;
  buffer: Uint8Array | null;

  status: number;
  statusText: string;
  url: string;
  date: Date;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraOpts: Record<string, any> | null;
  headers: Headers;
  noRW: boolean;
  isLive: boolean;
  updateTS: string | null;

  clonedResponse: Response | null = null;

  constructor({
    payload,
    status,
    statusText,
    headers,
    url,
    date,
    extraOpts = null,
    noRW = false,
    isLive = false,
    updateTS = null,
  }: ArchiveResponseOpts) {
    this.reader = null;
    this.buffer = null;

    if (payload && payload instanceof BaseAsyncIterReader) {
      this.reader = payload;
    } else {
      this.buffer = payload;
    }

    this.status = status;
    this.statusText = statusText || getStatusText(status);
    this.headers = headers;
    this.url = url;
    this.date = date;
    this.extraOpts = extraOpts;
    this.noRW = noRW;
    this.isLive = isLive;
    this.updateTS = updateTS;
  }

  async getText(isUTF8 = false): Promise<{ bomFound: boolean; text: string }> {
    const buff = await this.getBuffer();
    if (typeof buff === "string") {
      return { bomFound: false, text: buff };
    }
    if (!buff) {
      return { bomFound: false, text: "" };
    }

    // Check for BOMs -- since we're removing BOM, set 'bomFound'
    // to re-encode as UTF-8 without BOM
    // UTF-8
    if (buff[0] === 0xef && buff[1] === 0xbb && buff[2] === 0xbf) {
      return { bomFound: true, text: decoder.decode(buff.slice(3)) };
      // UTF-16BE -- convert to buffer, swap, and decode LE
    } else if (buff[0] === 0xfe && buff[1] === 0xff) {
      return {
        bomFound: true,
        text: Buffer.from(buff.slice(2)).swap16().toString("utf16le"),
      };
      // UTF-16LE -- convert to buffer, decode LE
    } else if (buff[0] === 0xff && buff[1] === 0xfe) {
      return {
        bomFound: true,
        text: Buffer.from(buff.slice(2)).toString("utf16le"),
      };
    }

    // if no BOM, go by 'isUTF8' param
    return {
      bomFound: false,
      text: isUTF8 ? decoder.decode(buff) : decodeLatin1(buff),
    };
  }

  setText(text: string, encodeUTF8 = false) {
    this.setBuffer(encodeUTF8 ? encoder.encode(text) : encodeLatin1(text));
  }

  async getBuffer() {
    if (this.buffer || !this.reader) {
      return this.buffer;
    }

    this.buffer = await this.reader.readFully();
    return this.buffer;
  }

  setBuffer(buffer: Uint8Array) {
    this.buffer = buffer;
    this.reader = null;
  }

  setReader(reader: BaseAsyncIterReader | ReadableStream) {
    if (reader instanceof BaseAsyncIterReader) {
      this.reader = reader;
      this.buffer = null;
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (reader.getReader) {
      this.reader = new AsyncIterReader(reader.getReader());
      this.buffer = null;
    }
  }

  expectedLength() {
    if (this.buffer) {
      return this.buffer.length;
    }
    //TODO
    //  else if (this.reader && this.reader.reader) {
    //   return this.reader.reader.length;
    // }
    return 0;
  }

  createIter() {
    const buffer = this.buffer;
    const reader = this.reader;

    async function* iter() {
      if (buffer) {
        let i = 0;

        yield buffer.slice(0, i + INITIAL_STREAM_CHUNK_SIZE);
        i += INITIAL_STREAM_CHUNK_SIZE;

        for (i; i < buffer.length; i += MAX_STREAM_CHUNK_SIZE) {
          yield buffer.slice(i, i + MAX_STREAM_CHUNK_SIZE);
        }
      } else if (reader) {
        yield* reader;
      }
    }

    return iter();
  }

  async *[Symbol.asyncIterator]() {
    yield* this.createIter();
  }

  setRange(range: string) {
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
    const end = Number(bytes[2]) || length - 1;

    if (!this.setRawRange(start, end)) {
      return false;
    }

    this.headers.set("Content-Range", `bytes ${start}-${end}/${length}`);
    this.headers.set("Content-Length", String(end - start + 1));

    this.status = 206;
    this.statusText = "Partial Content";

    return true;
  }

  setRawRange(start: number, end: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = this.reader as any;
    if (this.buffer) {
      this.buffer = this.buffer.slice(start, end + 1);
      return true;
    } else if (reader?.setLimitSkip) {
      reader.setLimitSkip(end - start + 1, start);
      return true;
    }

    return false;
  }

  makeResponse(coHeaders = false, overwriteDisposition = false) {
    let body: Uint8Array | ReadableStream | null = null;
    if (!isNullBodyStatus(this.status)) {
      body =
        this.buffer || !this.reader
          ? this.buffer
          : this.reader.getReadableStream();
    }

    const response = new Response(body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
    // slightly hacky
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (response as any).date = this.date;
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
