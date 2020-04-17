import { tsToDate } from './utils';
import { isPage } from './warcloader';


const BATCH_SIZE = 3000;


// ===========================================================================
class CDXLoader
{
  constructor(reader) {
    this.reader = reader;
  }

  async load(db) {
    const start = new Date().getTime();

    this.db = db;

    let count = 0;
    let batch = [];

    const promises = [];

    for await (const origLine of this.reader.iterLines()) {
      let cdx;
      let timestamp;
      let line = origLine.trimEnd();

      //console.log("Indexing: " + line);

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

      const { url, mime, digest } = cdx;

      const status = Number(cdx.status) || 200;

      const date = tsToDate(timestamp);
      const ts = date.getTime();

      if (isPage(url, status, mime)) {
        const title = url;
        promises.push(this.db.addPage({url, date: date.toISOString(), title}));
      }

      const source = {"path": cdx.filename,
                      "start": Number(cdx.offset),
                      "length": Number(cdx.length)};

      const entry = {url, ts, status, digest: "sha1:" + digest, mime, loaded: false, source};
      //console.log("Indexing: " + JSON.stringify(entry));

      //promises.push(this.db.addResource(entry));
      //await this.db.addResource(entry);
      if (batch.length >= BATCH_SIZE) {
        await this.db.addResources(batch);
        batch = [];
        console.log(`Read ${count += BATCH_SIZE} records`);
      }

      batch.push(entry);
    }

    if (batch.length > 0) {
      promises.push(this.db.addResources(batch));
    }

    await Promise.all(promises);

    console.log(`Indexed ${count += batch.length} records`);

    console.log(new Date().getTime() - start);
  }
}


export { CDXLoader };

