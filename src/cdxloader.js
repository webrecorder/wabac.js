import { tsToDate } from "./utils";
import { WARCLoader } from "./warcloader";

import { CDXIndexer, AsyncIterReader, appendRequestQuery } from "warcio";


const BATCH_SIZE = 3000;


// ===========================================================================
class CDXFromWARCLoader extends WARCLoader
{
  constructor(reader, abort, id, sourceExtra = {}, shaPrefix = "sha256:") {
    super(reader, abort, id);
    this.cdxindexer = null;
    this.sourceExtra = sourceExtra;
    this.shaPrefix = shaPrefix;
  }

  filterRecord(record) {
    switch (record.warcType) {
    case "warcinfo":
    case "revisit":
    case "request":
      return null;

    case "metadata":
      return this.shouldIndexMetadataRecord(record) ? null : "skip";
    }

    const url = record.warcTargetURI;
    const ts = new Date(record.warcDate).getTime();

    if (this.pageMap[ts + "/" + url]) {
      record._isPage = true;
      return null;
    }
  }

  index(record, parser) {
    if (record) {
      record._offset = parser.offset;
      record._length = parser.recordLength;
    }
    return super.index(record, parser);
  }

  indexReqResponse(record, reqRecord, parser) {
    if (record._isPage) {
      return super.indexReqResponse(record, reqRecord, parser);
    }

    if (record.warcType === "warcinfo") {
      this.parseWarcInfo(record);
      return;
    }

    if (!this.cdxindexer) {
      this.cdxindexer = new CDXIndexer({noSurt: true}, null);
    }

    const cdx = this.cdxindexer.indexRecordPair(record, reqRecord, parser, "");

    if (cdx) {
      this.addCdx(cdx);
    }
  }

  getSource(cdx) {
    return {
      ...this.sourceExtra,
      path: cdx.filename,
      start: Number(cdx.offset),
      length: Number(cdx.length)
    };
  }

  addCdx(cdx) {
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

    const entry = {url, ts, status, digest, recordDigest, mime, loaded: false, source};

    if (cdx.method) {
      entry.method = cdx.method;
    }

    // url with post query appended
    if (cdx.requestBody) {
      entry.url = appendRequestQuery(cdx.url, cdx.requestBody, cdx.method);
    }

    if (this.batch.length >= BATCH_SIZE) {
      this.flush();
    }

    this.batch.push(entry);
  }
}

// ===========================================================================
class CDXLoader extends CDXFromWARCLoader
{
  async load(db, progressUpdate, totalSize) {
    this.db = db;

    let reader = this.reader;

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
      if (progressUpdate && this.batch.length >= BATCH_SIZE) {
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

