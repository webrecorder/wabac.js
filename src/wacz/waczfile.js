import { createLoader } from "../blockloaders.js";
import { ZipRangeReader } from "./ziprangereader.js";

export const NO_LOAD_WACZ = "local";
export const DEFAULT_WACZ = "default";

export const INDEX_NOT_LOADED = 0;
export const INDEX_CDX = 1;
export const INDEX_IDX = 2;

//const INDEX_FULL = 3;

// ==========================================================================
export class WACZFile
{
  constructor({waczname, hash, url, entries = null, indexType = INDEX_NOT_LOADED, loader = null} = {}) {
    this.waczname = waczname;
    this.hash = hash;
    this.url = url;
    this.loader = loader;
    this.zipreader = null;
    this.entries = entries;
    this.indexType = indexType;
  }

  async init(url) {
    if (url) {
      this.url = url;
    }
    const loader = this.loader ? this.loader : await createLoader({url: this.url});

    return await this.initFromLoader(loader);
  }

  async initFromLoader(loader) {
    this.zipreader = new ZipRangeReader(loader, this.entries);

    if (!this.entries) {
      this.entries = await this.zipreader.load();
    }

    return this.entries;
  }

  containsFile(filename) {
    return !!this.entries[filename];
  }

  getSizeOf(filename) {
    return this.zipreader ? this.zipreader.getCompressedSize(filename) : 0 ;
  }

  serialize() {
    return {
      waczname: this.waczname,
      hash: this.hash,
      url: this.url,
      entries: this.entries,
      indexType: this.indexType
    };
  }

  async save(db, always = false) {
    const zipreader = this.zipreader;
    if (always || (zipreader && zipreader.entriesUpdated)) {
      await db.put("waczfiles", this.serialize());
      if (zipreader) {
        zipreader.entriesUpdated = false;
      }
    }
  }

  iterContainedFiles() {
    return this.entries ? Object.keys(this.entries) : [];
  }
}