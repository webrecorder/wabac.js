
import { Bundle } from 'wbn';


// ===========================================================================
class WBNLoader {
  constructor(buffer) {
    this.bundle = new Bundle(Buffer.from(buffer));
  }

  load(db) {
    this.db = db;
    const url = this.bundle.primaryURL;
    const date = "";
    const title = url;

    this.db.addPage({url, date, title});

    for (const url of this.bundle.urls) {
      const resp = this.bundle.getResponse(url);

      const ts = new Date().getTime();

      this.db.addResource({url,
                           ts,
                           status: resp.status,
                           respHeaders: resp.headers,
                           payload: resp.body
                          });
    }
  }
}

export { WBNLoader };
 
