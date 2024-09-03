import { ResourceEntry } from "./types";
import { tsToDate } from "./utils";
import { WARCLoader } from "./warcloader";

import { CDXIndexer, AsyncIterReader, appendRequestQuery, WARCRecord, WARCParser, Source } from "warcio";


export const CDX_COOKIE = "req.http:cookie";

type WARCRecordWithPage = WARCRecord & {
  _isPage: boolean;
};


// ===========================================================================
class CDXFromWARCLoader extends WARCLoader
{
  cdxindexer: CDXIndexer | null = null;
  sourceExtra: any;
  shaPrefix: string;

  constructor(reader: Source, abort: AbortController | null, id: string, sourceExtra = {}, shaPrefix = "sha256:") {
    super(reader, abort, id);
    this.sourceExtra = sourceExtra;
    this.shaPrefix = shaPrefix;
  }

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
    const ts = record.warcDate ? new Date(record.warcDate).getTime() : Date.now();

    if (this.pageMap[ts + "/" + url]) {
      record._isPage = true;
      return null;
    }

    return null;
  }

  index(record: WARCRecord, parser: WARCParser) {
    if (record) {
      record._offset = parser.offset;
      record._length = parser.recordLength;
    }
    return super.index(record, parser);
  }

  indexReqResponse(record: WARCRecordWithPage, reqRecord: WARCRecord, parser: WARCParser) {
    if (record._isPage) {
      return super.indexReqResponse(record, reqRecord, parser);
    }

    if (record.warcType === "warcinfo") {
      this.parseWarcInfo(record);
      return;
    }

    if (!this.cdxindexer) {
      this.cdxindexer = new CDXIndexer({noSurt: true});
    }

    const cdx = this.cdxindexer.indexRecordPair(record, reqRecord, parser, "");

    if (!cdx) {
      return;
    }

    if (cdx.status === 206) {
      const headers = record.httpHeaders?.headers;
      if (headers && !this.isFullRangeRequest(headers)) {
        return;
      }
    }

    if (reqRecord && reqRecord.httpHeaders) {
      let cookie = reqRecord.httpHeaders.headers.get("cookie");
      if (cookie) {
        cdx[CDX_COOKIE] = cookie;
      }
    }

    this.addCdx(cdx);
  }

  getSource(cdx: Record<string, any>) {
    return {
      ...this.sourceExtra,
      path: cdx.filename,
      start: Number(cdx.offset),
      length: Number(cdx.length)
    };
  }

  addCdx(cdx: Record<string, any>) {
    const { url, mime } = cdx;

    const status = Number(cdx.status) || 200;

    const date = tsToDate(cdx.timestamp);
    const ts = date.getTime();

    //if (this.detectPages && isPage(url, status, mime)) {
    //  const title = url;
    //  promises.push(this.db.addPage({url, date: date.toISOString(), title}));
    //}

    const source = this.getSource(cdx);

    let { digest, recordDigest } = cdx;
    if (digest && digest.indexOf(":") === -1) {
      digest = this.shaPrefix + digest;
    }

    const entry : ResourceEntry = {url, ts, status, digest, recordDigest, mime, loaded: false, source};

    if (cdx.method) {
      if (cdx.method === "HEAD" || cdx.method === "OPTIONS") {
        return;
      }
      entry.method = cdx.method;
    }

    if (cdx[CDX_COOKIE]) {
      entry[CDX_COOKIE] = cdx[CDX_COOKIE];
    }

    // url with post query appended
    if (cdx.method && cdx.method !== "GET") {
      entry.url = appendRequestQuery(cdx.url, cdx.requestBody || "", cdx.method);
    }

    this.addResource(entry);
  }
}

// ===========================================================================
class CDXLoader extends CDXFromWARCLoader
{
  async load(db: any, progressUpdate?: any, totalSize?: number) {
    this.db = db;

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
        cdx = JSON.parse(line);
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
        progressUpdate(Math.round((numRead / totalSize) * 100), null, numRead, totalSize);
      }
      this.addCdx(cdx);
    }

    await this.finishIndexing();

    if (progressUpdate) {
      progressUpdate(100, null, totalSize, totalSize);
    }
  }
}


export { CDXLoader, CDXFromWARCLoader };

