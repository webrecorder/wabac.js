import { tsToDate } from './utils';
import { WARCLoader } from './warcloader';

import { CDXIndexer } from 'warcio';


const BATCH_SIZE = 3000;


// ===========================================================================
class CDXFromWARCLoader extends WARCLoader
{
  constructor(reader) {
    super(reader);
    this.cdxindexer = null;
  }

  filterRecord(record) {
    return record.warcType === "warcinfo" ? null : "skipContent";
  }

  index(record, parser) {
    if (record.warcType === "warcinfo") {
      this.parseWarcInfo(record);
      return;
    }

    if (record.warcType === "request") {
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

  indexDone() {

  }

  addCdx(cdx) {
    const { url, mime, digest } = cdx;

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

    const entry = {url, ts, status, digest: "sha1:" + digest, mime, loaded: false, source};
    //console.log("Indexing: " + JSON.stringify(entry));

    //promises.push(this.db.addResource(entry));
    //await this.db.addResource(entry);
    if (this.batch.length >= BATCH_SIZE) {
      this.promises.push(this.db.addResources(this.batch));
      this.batch = [];
      console.log(`Read ${this.count += BATCH_SIZE} records`);
    }

    this.batch.push(entry);
  }
}

// ===========================================================================
class CDXLoader extends CDXFromWARCLoader
{
  async load(db) {
    const start = new Date().getTime();

    this.db = db;

    for await (const origLine of this.reader.iterLines()) {
      let cdx;
      let timestamp;
      let line = origLine.trimEnd();

      if (!line.startsWith("{")) {
        const inx = line.indexOf(" {");
        if (inx < 0) {
          continue;
        }
        timestamp = line.split(" ", 2)[1];
        line = line.slice(inx);
      }

      try {
        cdx = JSON.parse(line);
      } catch (e) {
        console.log("JSON Parser error on: " + line);
        continue;
      }

      cdx.timestamp = timestamp;
      this.addCdx(cdx);
    }

    this.indexDone();

    await this.finishIndexing();
  }
}


export { CDXLoader, CDXFromWARCLoader };

