import { makeHeaders, Canceled, tsToDate } from "./utils";

import {
  type BaseAsyncIterReader,
  type Source,
  WARCParser,
  type WARCRecord,
  postToGetUrl,
} from "warcio";

import { extractText } from "./extract";

import { BaseParser } from "./baseparser";
import { type CollMetadata, type ResourceEntry } from "./types";

// ===========================================================================
class WARCLoader extends BaseParser {
  reader: Source;
  abort: AbortController | null;
  loadId: string | null;
  sourceExtra: object | null;

  anyPages = false;
  detectPages = false;

  _lastRecord: WARCRecord | null = null;

  metadata: CollMetadata = {};
  pages: string[] = [];
  lists: string[] = [];
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageMap: Record<string, any> = {};

  constructor(
    reader: Source,
    abort: AbortController | null = null,
    loadId: string | null = null,
    sourceExtra = null,
  ) {
    super();

    this.reader = reader;
    this.abort = abort;
    this.loadId = loadId;

    this._lastRecord = null;

    this.metadata = {};

    this.pageMap = {};
    this.pages = [];
    this.lists = [];

    this.sourceExtra = sourceExtra;
  }

  parseWarcInfo(record: WARCRecord) {
    if (!record.payload) {
      return;
    }
    const dec = new TextDecoder("utf-8");
    const text = dec.decode(record.payload);

    // Webrecorder-style metadata
    for (const line of text.split("\n")) {
      if (!line.startsWith("json-metadata:")) {
        continue;
      }

      try {
        const json = JSON.parse(line.slice("json-metadata:".length));

        if (json.type === "collection") {
          this.metadata.desc = json.desc;
          this.metadata.title = json.title;
        }

        if (json.pages?.length) {
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          this.pages = this.pages.concat(json.pages);

          for (const page of json.pages) {
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            page.ts = tsToDate(page.timestamp).getTime();
            this.pageMap[page.ts + "/" + page.url] = { page };
          }
          //this.promises.push(this.db.addPages(pages));
          this.anyPages = true;
        }

        if (json.lists?.length) {
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          this.lists = this.lists.concat(json.lists);
          //  this.promises.push(this.db.addCuratedPageLists(lists, "bookmarks", "public"));
        }
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        console.log("Page Add Error", e.toString());
      }
    }
  }

  index(record: WARCRecord, parser: WARCParser) {
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
      this.indexReqResponse(this._lastRecord, null, parser);
      this._lastRecord = record;
      return;
    }

    if (
      record.warcType === "request" &&
      this._lastRecord.warcType === "response"
    ) {
      this.indexReqResponse(this._lastRecord, record, parser);
      this._lastRecord = null;
    } else if (
      record.warcType === "response" &&
      this._lastRecord.warcType === "request"
    ) {
      this.indexReqResponse(record, this._lastRecord, parser);
      this._lastRecord = null;
    } else {
      this.indexReqResponse(this._lastRecord, null, parser);
      this._lastRecord = record;
    }
  }

  indexDone(parser: WARCParser) {
    if (this._lastRecord) {
      this.indexReqResponse(this._lastRecord, null, parser);
      this._lastRecord = null;
    }
  }

  shouldIndexMetadataRecord(record: WARCRecord) {
    const targetURI = record.warcTargetURI;
    if (targetURI?.startsWith("metadata://")) {
      return true;
    }

    return false;
  }

  parseRevisitRecord(
    record: WARCRecord,
    reqRecord: WARCRecord | null,
  ): ResourceEntry | null {
    const url = record.warcTargetURI!.split("#")[0];
    const date = record.warcDate;
    const ts = date ? new Date(date).getTime() : Date.now();

    let respHeaders: Record<string, string> | null = null;

    let status: number | undefined;

    if (record.httpHeaders) {
      // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
      const parsed = this.parseResponseHttpHeaders(record, url, reqRecord);
      if (parsed) {
        respHeaders = Object.fromEntries(parsed.headers.entries());
        status = parsed.status;
      }
    }

    const origURL = record.warcRefersToTargetURI;
    const origTS = new Date(record.warcRefersToDate!).getTime();

    // self-revisit, skip
    if (origURL === url && origTS === ts) {
      return null;
    }

    const digest = record.warcPayloadDigest || null;

    return {
      // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string'.
      url,
      ts,
      origURL,
      origTS,
      digest,
      pageId: null,
      respHeaders,
      status,
    };
  }

  parseResponseHttpHeaders(
    record: WARCRecord,
    url: string,
    reqRecord: WARCRecord | null,
  ) {
    let status = 200;
    let headers: Headers | null = null;
    let mime = "";

    const method = reqRecord?.httpHeaders?.method;

    if (record.httpHeaders) {
      status = Number(record.httpHeaders.statusCode) || 200;

      if (method === "OPTIONS" || method === "HEAD") {
        return null;
      }

      //statusText = record.httpHeaders.statusText;

      headers = makeHeaders(record.httpHeaders.headers);

      //if (!reqRecord && !record.content.length &&
      //    (headers.get("access-control-allow-methods") || headers.get("access-control-allow-credentials"))) {
      //  return null;
      //}

      // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string'.
      mime = (headers.get("content-type") || "").split(";")[0];

      // skip partial responses (not starting from 0)
      if (status === 206 && !this.isFullRangeRequest(headers)) {
        return null;
      }

      // self-redirects not handled at lookup time
      // if (status > 300 && status < 400) {
      //   const location = headers.get("location");
      //   if (location) {
      //     if (new URL(location, url).href === url) {
      //       return null;
      //     }
      //   }
      // }
    } else {
      headers = new Headers();
      headers.set("content-type", record.warcContentType!);
      headers.set("content-length", String(record.warcContentLength));
      mime = record.warcContentType || "";

      //cl = record.warcContentLength;
    }

    return { status, method, headers, mime };
  }

  indexReqResponse(
    record: WARCRecord,
    reqRecord: WARCRecord | null,
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    parser: WARCParser,
  ) {
    const entry = this.parseRecords(record, reqRecord);

    if (entry) {
      this.addResource(entry);
    }
  }

  parseRecords(
    record: WARCRecord,
    reqRecord: WARCRecord | null,
  ): ResourceEntry | null {
    switch (record.warcType) {
      case "revisit":
        return this.parseRevisitRecord(record, reqRecord);

      case "resource":
        reqRecord = null;
        break;

      case "response":
        break;

      case "metadata":
        if (!this.shouldIndexMetadataRecord(record)) {
          return null;
        }
        break;

      default:
        return null;
    }

    let url = record.warcTargetURI!.split("#")[0];
    const date = record.warcDate;

    // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
    const parsed = this.parseResponseHttpHeaders(record, url, reqRecord);

    if (!parsed) {
      return null;
    }

    const { status, method, headers, mime } = parsed;

    let referrer: string | null = null;
    let requestBody: Uint8Array | null = null;
    let requestUrl;
    let reqHeaders;

    if (reqRecord?.httpHeaders?.headers) {
      let requestHeaders: Headers | null = null;
      try {
        requestHeaders = new Headers(reqRecord.httpHeaders.headers as Headers);
        const cookie = requestHeaders.get("cookie");
        if (cookie) {
          headers.set("x-wabac-preset-cookie", cookie);
        }
        referrer = reqRecord.httpHeaders.headers.get("Referer") || null;
      } catch (e) {
        requestHeaders = new Headers();
        console.warn(e);
      }

      reqHeaders = Object.fromEntries(requestHeaders.entries());

      if (method !== "GET") {
        const data = {
          headers: requestHeaders,
          method: method || "GET",
          url,
          postData: reqRecord.payload,
        };

        // @ts-expect-error [TODO] - TS2345 - Argument of type '{ headers: Headers; method: string; url: string | undefined; postData: Uint8Array | null; }' is not assignable to parameter of type 'Request'.
        if (postToGetUrl(data)) {
          // original requestUrl
          requestUrl = url;

          // url with post data appended
          url = data.url;

          // raw request payload (for future serialization)
          requestBody = reqRecord.payload;
        }
      }
    }

    // if no pages found, start detection if hasn't started already
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.detectPages === undefined) {
      this.detectPages = !this.anyPages;
    }

    if (this.detectPages) {
      // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
      if (isPage(url, status, mime)) {
        const title = url;
        // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string'.
        this.addPage({ url, date, title });
      }
    }

    const ts = date ? new Date(date).getTime() : Date.now();

    const respHeaders = Object.fromEntries(headers.entries());

    const digest = record.warcPayloadDigest || null;

    const payload = record.payload;
    const reader: BaseAsyncIterReader | null = payload
      ? null
      : (record.reader as BaseAsyncIterReader);

    const entry: ResourceEntry = {
      // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string'.
      url,
      ts,
      status,
      mime,
      respHeaders,
      reqHeaders,
      digest,
      payload,
      reader,
      referrer,
    };

    if (this.pageMap[ts + "/" + url] && payload && mime.startsWith("text/")) {
      this.pageMap[ts + "/" + url].textPromise = extractText(
        // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
        url,
        payload,
        headers.get("content-encoding"),
        headers.get("transfer-encoding"),
      );
    }

    const extraMetadata = record.warcHeader("WARC-JSON-Metadata");

    if (extraMetadata) {
      try {
        entry.extraOpts = JSON.parse(extraMetadata);
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // ignore error on extraOpts
      }
    }

    const pageId = record.warcHeader("WARC-Page-ID");

    if (pageId) {
      entry.pageId = pageId;
    }

    if (this.sourceExtra) {
      // @ts-expect-error [TODO] - TS2322 - Type 'object' is not assignable to type 'Source | undefined'.
      entry.source = this.sourceExtra;
    }

    if (method !== "GET" && requestUrl) {
      entry.requestUrl = requestUrl;
      entry.method = method;
      entry.requestBody = requestBody || new Uint8Array([]);
    }

    return entry;
  }

  isFullRangeRequest(headers: Headers | Map<string, string>) {
    const range = headers.get("content-range");

    const cl = parseInt(headers.get("content-length") || "0");

    const fullRange = `bytes 0-${cl - 1}/${cl}`;

    // full range is range exists and matches expected full range
    return range && range === fullRange;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filterRecord(record: WARCRecord): string | null {
    return null;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async load(db: any, progressUpdate: any, totalSize = 0) {
    if (progressUpdate && !totalSize) {
      throw new Error("totalSize is required");
    }
    this.db = db;

    const parser = new WARCParser(this.reader);

    let lastUpdate = 0,
      updateTime = 0;
    let count = 0;

    try {
      for await (const record of parser) {
        count++;

        if (!record.warcType) {
          console.log("skip empty record");
          continue;
        }

        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const interruptLoads = (self as any).interruptLoads as Record<
          string,
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          any
        >;

        // [TODO]

        if (progressUpdate && this.loadId && interruptLoads[this.loadId]) {
          progressUpdate(
            Math.round((parser.offset / totalSize) * 95.0),
            "Loading Canceled",
            parser.offset,
            totalSize,
          );
          interruptLoads[this.loadId]();
          if (this.abort) {
            this.abort.abort();
          }
          throw new Canceled();
        }

        updateTime = new Date().getTime();
        if (updateTime - lastUpdate > 500) {
          const extraMsg = `Processed ${count} records`;
          progressUpdate(
            Math.round((parser.offset / totalSize) * 95.0),
            null,
            parser.offset,
            totalSize,
            null,
            extraMsg,
          );
          lastUpdate = updateTime;
        }

        const skipMode = this.filterRecord(record);
        if (skipMode === "done") {
          if (this.abort) {
            this.abort.abort();
          }
          break;
        } else if (skipMode === "skip") {
          continue;
        }

        if (skipMode === "skipContent") {
          await record.skipFully();
        } else {
          await record.readFully();
        }

        count++;

        this.index(record, parser);

        if (this.promises.length > 0) {
          try {
            await Promise.all(this.promises);
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            console.warn(e.toString());
          }
          this.promises = [];
        }
      }
    } catch (e) {
      if (e instanceof Canceled) {
        throw e;
      }

      progressUpdate(
        Math.round((parser.offset / totalSize) * 95.0),
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Sorry there was an error downloading. Please try again (${e})`,
        parser.offset,
        totalSize,
      );

      console.warn(e);
    }

    this.indexDone(parser);

    progressUpdate(95, null, parser.offset, totalSize);

    await this.finishIndexing();

    progressUpdate(100, null, totalSize, totalSize);

    return this.metadata;
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'BaseParser'.
  async _finishLoad() {
    if (this.pages.length) {
      for (const { page, textPromise } of Object.values(this.pageMap)) {
        if (textPromise) {
          try {
            page.text = await textPromise;
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            console.warn("Error adding text: " + e.toString());
          }
        }
      }
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      this.promises.push(this.db.addPages(this.pages));
    }

    if (this.lists.length) {
      this.promises.push(
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.db.addCuratedPageLists(this.lists, "bookmarks", "public"),
      );
    }
  }
}

// ===========================================================================
function isPage(url: string, status: number, mime: string) {
  if (status != 200) {
    return false;
  }

  if (
    !url.startsWith("http:") &&
    !url.startsWith("https:") &&
    !url.startsWith("blob:")
  ) {
    return false;
  }

  if (url.endsWith("/robots.txt")) {
    return false;
  }

  // skip urls with long query
  const parts = url.split("?", 2);

  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'. | TS2532 - Object is possibly 'undefined'.
  if (parts.length === 2 && parts[1].length > parts[0].length) {
    return false;
  }

  // skip 'files' starting with '.' from being listed as pages
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'. | TS2532 - Object is possibly 'undefined'.
  if (parts[0].substring(parts[0].lastIndexOf("/") + 1).startsWith(".")) {
    return false;
  }

  if (mime && mime !== "text/html") {
    return false;
  }

  return true;
}

// ===========================================================================
class SingleRecordWARCLoader extends WARCLoader {
  constructor(reader: Source) {
    super(reader);
    this.detectPages = false;
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WARCLoader'.
  addPage() {}

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WARCLoader'.
  async load() {
    const record = await new WARCParser(this.reader).parse();

    if (!record) {
      return null;
    }

    const entry = this.parseRecords(record, null);

    if (!entry || record.warcType === "revisit") {
      await record.readFully();
    }

    return entry;
  }
}

// ===========================================================================
class WARCInfoOnlyWARCLoader extends WARCLoader {
  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WARCLoader'.
  filterRecord(record: WARCRecord) {
    if (record.warcType != "warcinfo") {
      return "done";
    }

    return null;
  }
}

export { WARCLoader, SingleRecordWARCLoader, isPage, WARCInfoOnlyWARCLoader };
