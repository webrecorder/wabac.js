
import { Bundle } from 'wbn';
import { BaseParser } from './baseparser';


// ===========================================================================
class WBNLoader extends BaseParser {
  constructor(buffer) {
    super();

    this.bundle = new Bundle(Buffer.from(buffer));
  }

  async load(db) {
    this.db = db;
    const url = this.bundle.primaryURL;

    const date = new Date();

    const ts = date.getTime();

    const title = url;

    this.addPage({url, date: date.toISOString(), title});

    for (const url of this.bundle.urls) {
      const resp = this.bundle.getResponse(url);

      this.addResource({url,
                        ts,
                        status: resp.status,
                        respHeaders: resp.headers,
                        payload: resp.body
                       });
    }

    await this.finishIndexing();

    return {};
  }
}

export { WBNLoader };
 
