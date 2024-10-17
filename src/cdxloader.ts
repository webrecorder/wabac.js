import { type ResourceEntry } from "./types";
import { tsToDate } from "./utils";
import { WARCLoader } from "./warcloader";

import {
  CDXIndexer,
  AsyncIterReader,
  appendRequestQuery,
  type WARCRecord,
  type WARCParser,
  type Source,
} from "warcio";

export const CDX_COOKIE = "req.http:cookie";

type WARCRecordWithPage = WARCRecord & {
  _isPage: boolean;
};

// ===========================================================================
class CDXFromWARCLoader extends WARCLoader {
  cdxindexer: CDXIndexer | null = null;
  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WARCLoader'.
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceExtra: any;
  shaPrefix: string;

  constructor(
    reader: Source,
    abort: AbortController | null,
    id: string,
    sourceExtra = {},
    shaPrefix = "sha256:",
  ) {
    super(reader, abort, id);
    this.sourceExtra = sourceExtra;
    this.shaPrefix = shaPrefix;
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WARCLoader'.
  filterRecord(record: WARCRecordWithPage) {
    switch (record.warcType) {
      case "warcinfo":
      case "revisit":
      case "request":
        return null;

      case "metadata":
        return this.shouldIndexMetadataRecord(record) ? null : "skip";
    }

    const url = record.warcTargetURI;
    const ts = record.warcDate
      ? new Date(record.warcDate).getTime()
      : Date.now();

    if (this.pageMap[ts + "/" + url]) {
      record._isPage = true;
      return null;
    }

    return null;
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WARCLoader'.
  index(record: WARCRecord, parser: WARCParser) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (record) {
      record._offset = parser.offset;
      record._length = parser.recordLength;
    }
    return super.index(record, parser);
  }

  // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'WARCLoader'.
  indexReqResponse(
    record: WARCRecordWithPage,
    reqRecord: WARCRecord,
    parser: WARCParser,
  ) {
    if (record._isPage) {
      return super.indexReqResponse(record, reqRecord, parser);
    }

    if (record.warcType === "warcinfo") {
      this.parseWarcInfo(record);
      return;
    }

    if (!this.cdxindexer) {
      this.cdxindexer = new CDXIndexer({ noSurt: true });
    }

    const cdx = this.cdxindexer.indexRecordPair(record, reqRecord, parser, "");

    if (!cdx) {
      return;
    }

    if (cdx["status"] === 206) {
      const headers = record.httpHeaders?.headers;
      if (headers && !this.isFullRangeRequest(headers)) {
        return;
      }
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain
    if (reqRecord && reqRecord.httpHeaders) {
      const cookie = reqRecord.httpHeaders.headers.get("cookie");
      if (cookie) {
        cdx[CDX_COOKIE] = cookie;
      }
    }

    this.addCdx(cdx);
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSource(cdx: Record<string, any>) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
      ...this.sourceExtra,
      // @ts-expect-error [TODO] - TS4111 - Property 'filename' comes from an index signature, so it must be accessed with ['filename'].
      path: cdx.filename,
      // @ts-expect-error [TODO] - TS4111 - Property 'offset' comes from an index signature, so it must be accessed with ['offset'].
      start: Number(cdx.offset),
      // @ts-expect-error [TODO] - TS4111 - Property 'length' comes from an index signature, so it must be accessed with ['length'].
      length: Number(cdx.length),
    };
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCdx(cdx: Record<string, any>) {
    const { url, mime } = cdx;

    // @ts-expect-error [TODO] - TS4111 - Property 'status' comes from an index signature, so it must be accessed with ['status'].
    const status = Number(cdx.status) || 200;

    // @ts-expect-error [TODO] - TS4111 - Property 'timestamp' comes from an index signature, so it must be accessed with ['timestamp'].
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const date = tsToDate(cdx.timestamp);
    const ts = date.getTime();

    //if (this.detectPages && isPage(url, status, mime)) {
    //  const title = url;
    //  promises.push(this.db.addPage({url, date: date.toISOString(), title}));
    //}

    const source = this.getSource(cdx);

    // [TODO]
    // eslint-disable-next-line prefer-const
    let { digest, recordDigest } = cdx;
    if (digest && digest.indexOf(":") === -1) {
      digest = this.shaPrefix + digest;
    }

    const entry: ResourceEntry = {
      url,
      ts,
      status,
      digest,
      recordDigest,
      mime,
      loaded: false,
      source,
    };

    // @ts-expect-error [TODO] - TS4111 - Property 'method' comes from an index signature, so it must be accessed with ['method'].
    if (cdx.method) {
      // @ts-expect-error [TODO] - TS4111 - Property 'method' comes from an index signature, so it must be accessed with ['method']. | TS4111 - Property 'method' comes from an index signature, so it must be accessed with ['method'].
      if (cdx.method === "HEAD" || cdx.method === "OPTIONS") {
        return;
      }
      // @ts-expect-error [TODO] - TS4111 - Property 'method' comes from an index signature, so it must be accessed with ['method'].
      entry.method = cdx.method;
    }

    if (cdx[CDX_COOKIE]) {
      entry[CDX_COOKIE] = cdx[CDX_COOKIE];
    }

    // url with post query appended
    // @ts-expect-error [TODO] - TS4111 - Property 'method' comes from an index signature, so it must be accessed with ['method']. | TS4111 - Property 'method' comes from an index signature, so it must be accessed with ['method'].
    if (cdx.method && cdx.method !== "GET") {
      entry.url = appendRequestQuery(
        // @ts-expect-error [TODO] - TS4111 - Property 'url' comes from an index signature, so it must be accessed with ['url'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        cdx.url,
        // @ts-expect-error [TODO] - TS4111 - Property 'requestBody' comes from an index signature, so it must be accessed with ['requestBody'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        cdx.requestBody || "",
        // @ts-expect-error [TODO] - TS4111 - Property 'method' comes from an index signature, so it must be accessed with ['method'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        cdx.method,
      );
    }

    this.addResource(entry);
  }
}

// ===========================================================================
class CDXLoader extends CDXFromWARCLoader {
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async load(db: any, progressUpdate?: any, totalSize?: number) {
    this.db = db;

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reader = this.reader as any;

    if (!reader.iterLines) {
      reader = new AsyncIterReader(this.reader);
    }

    let numRead = 0;

    for await (const origLine of reader.iterLines()) {
      let cdx;
      let urlkey;
      let timestamp;
      numRead += origLine.length;
      let line = origLine.trimEnd();

      if (!line.startsWith("{")) {
        const inx = line.indexOf(" {");
        if (inx < 0) {
          continue;
        }
        [urlkey, timestamp] = line.split(" ", 2);
        line = line.slice(inx);
      }

      try {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        cdx = JSON.parse(line);
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        console.log("JSON Parser error on: " + line);
        continue;
      }

      cdx.timestamp = timestamp;
      if (!cdx.url) {
        cdx.url = urlkey;
        console.warn(`URL missing, using urlkey ${urlkey}`);
      }
      if (progressUpdate && totalSize && this.isBatchFull()) {
        progressUpdate(
          Math.round((numRead / totalSize) * 100),
          null,
          numRead,
          totalSize,
        );
      }
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      this.addCdx(cdx);
    }

    await this.finishIndexing();

    if (progressUpdate) {
      progressUpdate(100, null, totalSize, totalSize);
    }

    return {};
  }
}

export { CDXLoader, CDXFromWARCLoader };
