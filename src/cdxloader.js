import { tsToDate } from './utils';
import { isPage } from './warcloader';


// ===========================================================================
class CDXLoader
{
  constructor(stream) {
    this.stream = stream;
  }

  async load(db) {
    this.db = db;

    for await (const origLine of this.stream.iterLines()) {
      let cdx;
      let timestamp;
      let line = origLine.trimEnd();

      console.log("Indexing: " + line);

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
        this.db.addPage({url, date: date.toISOString(), title});
      }

      const source = {"path": cdx.filename,
                      "start": Number(cdx.offset),
                      "length": Number(cdx.length)};

      const entry = {url, ts, status, digest: "sha1:" + digest, mime, loaded: false, source};
      //console.log("Indexing: " + JSON.stringify(entry));

      await this.db.addResource(entry);
    }
  }
}


export { CDXLoader };

