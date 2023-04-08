import { ZipBlockLoader, ZipRangeReader } from "./ziprangereader.js";

export const NO_LOAD_WACZ = "local";
export const DEFAULT_WACZ = "default";

export const INDEX_NOT_LOADED = 0;
export const INDEX_CDX = 1;
export const INDEX_IDX = 2;

export const WACZ_LEAF = "wacz";
export const MULTI_WACZ = "multi-wacz";

// ==========================================================================
class WACZLoadSource
{
  getURL(/*path*/) {
    // not implemented;
  }

  getName(/*name*/) {
    // not implemented;
  }

  async createLoader(/*opts*/) {
    // not implemented;
  }
}

// ==========================================================================
export class WACZFile extends WACZLoadSource
{
  constructor({waczname, hash, path, parent = null, entries = null, fileType = WACZ_LEAF, indexType = INDEX_NOT_LOADED, loader = null} = {}) {
    super();
    this.waczname = waczname;
    this.hash = hash;
    this.path = path;
    this.loader = loader;
    this.parent = parent;
    this.zipreader = null;
    this.entries = entries;
    this.indexType = indexType;
    this.fileType = fileType;
  }

  markAsMultiWACZ() {
    this.fileType = MULTI_WACZ;
  }

  async init(path) {
    if (path) {
      this.path = path;
    }
    const loader = this.loader ? this.loader : await this.parent.createLoader({url: this.path});

    return await this.initFromLoader(loader);
  }

  async initFromLoader(loader) {
    this.zipreader = new ZipRangeReader(loader, this.entries);

    if (!this.entries) {
      this.entries = await this.zipreader.load();
    }

    return this.entries;
  }

  async loadFile(filename, opts) {
    if (!this.zipreader) {
      await this.init();
    }

    return await this.zipreader.loadFile(filename, opts);
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
      path: this.path,
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

  getURL(path) {
    return this.waczname + "#!/" + path;
  }

  getName(name) {
    return this.waczname + "#!/" + name;
  }

  async createLoader(opts) {
    const { url } = opts;
    const inx = url.lastIndexOf("#!/");

    if (!this.zipreader) {
      await this.init();
    }

    if (inx >= 0) {
      return new ZipBlockLoader(this.zipreader, url.slice(inx + 3));
    }
  }
}