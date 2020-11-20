import { tsToDate } from './utils';
import { WARCLoader } from './warcloader';

import { CDXIndexer, AsyncIterReader } from 'warcio';


const BATCH_SIZE = 3000;


// ===========================================================================
class CDXFromWARCLoader extends WARCLoader
{
  constructor(reader, abort, id) {
    super(reader, abort, id);
    this.cdxindexer = null;
  }

  filterRecord(record) {
    switch (record.warcType) {
      case "warcinfo":
      case "revisit":
        return null;

      case "request":
        return "skipContent";

      case "metadata":
        return this.shouldIndexMetadataRecord(record) ? null : "skipContent";
    }

    const url = record.warcTargetURI;
    const ts = new Date(record.warcDate).getTime();

    if (this.pageMap[ts + "/" + url]) {
      record._isPage = true;
      return null;
    }
  }

  index(record, parser) {
    if (record._isPage) {
      return super.index(record, parser);
    }

    if (record.warcType === "warcinfo") {
      this.parseWarcInfo(record);
      return;
    }

    if (!this.cdxindexer) {
      this.cdxindexer = new CDXIndexer({}, null);
    }

    const cdx = this.cdxindexer.indexRecord(record, parser, "");

    if (cdx) {
      this.addCdx(cdx);
    }
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

    const source = {"path": cdx.filename,
                    "start": Number(cdx.offset),
                    "length": Number(cdx.length)};

    let { digest } = cdx;
    if (digest && digest.indexOf(":") === -1) {
      digest = "sha1:" + digest;
    }

    const entry = {url, ts, status, digest, mime, loaded: false, source};

    if (this.batch.length >= BATCH_SIZE) {
      this.flush();
    }

    this.batch.push(entry);
  }
}

// ===========================================================================
class CDXLoader extends CDXFromWARCLoader
{
  async load(db) {
    this.db = db;

    let reader = this.reader;

    if (!reader.iterLines) {
      reader = new AsyncIterReader(this.reader);
    }

    for await (const origLine of reader.iterLines()) {
      let cdx;
      let urlkey;
      let timestamp;
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
      }
      this.addCdx(cdx);
    }

    this.indexDone();

    await this.finishIndexing();
  }
}


export { CDXLoader, CDXFromWARCLoader };

