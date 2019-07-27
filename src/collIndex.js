"use strict";

import { openDB } from "idb/with-async-ittr.js";

class WarcIndexer {
  constructor(collDB) {
    this.parser = new WarcParser();
    this.collDB = collDB;
  }

  index(file) {
    this.parser.parse(file, this.buildCdx.bind(this)).then(function () {
      console.log('all done')
    });
  }

  async buildCdx(record, cdx) {
    cdx.url = record.warcTargetURI;
    cdx.timestamp = record.warcDate.replace(/[^\d]/g, "");
    let status = record.httpInfo && record.httpInfo.statusCode;
    if (status) {
      cdx.status = record.httpInfo.statusCode;
    }
    cdx.type = record.warcType;
    cdx.digest = record.warcPayloadDigest;
    cdx.urlKey = cdx.url + " " + cdx.timestamp;

    await this.collDB.writeTransaction().put(cdx);
    console.log(cdx);
  }
}

class CollectionIndex {
  constructor(name) {
    this.name = name;
  }

  async init() {
    this.db = await openDB(this.name, 1, {
      upgrade(db, oldVersion, newVersion, transaction) {
        db.createObjectStore("cdx", { keyPath: "urlKey" });
      }
    });
  }

  writeTransaction() {
    return this.db.transaction("cdx", "readwrite").objectStore("cdx");
  }

  getLookupRange(url, type) {
    type = type || "exact";

    switch (type) {
      case "prefix":
        upper = url.slice(0, -1) + String.fromCharCode(url.charCodeAt(url.length - 1) + 1);
        return IDBKeyRange(url, upper, false, true);

      case "host":
        let origin = new URL(url).origin;
        return IDBKeyRange(origin + "/", origin + "0", false, true);

      case "exact":
      default:
        return IDBKeyRange(url, url + "!", false, true);
    }
  }
}

export { CollectionIndex };


