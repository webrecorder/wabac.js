import { type BaseLoader } from "../blockloaders";
import {
  type LoadWACZEntry,
  ZipBlockLoader,
  ZipRangeReader,
} from "./ziprangereader";

export const NO_LOAD_WACZ = "local";
export const DEFAULT_WACZ = "default";

export type IndexType = 0 | 1 | 2;
export const INDEX_NOT_LOADED = 0;
export const INDEX_CDX = 1;
export const INDEX_IDX = 2;

export type WACZType = "wacz" | "multi-wacz";
export const WACZ_LEAF = "wacz";
export const MULTI_WACZ = "multi-wacz";

// ==========================================================================
export interface WACZLoadSource {
  getLoadPath: (path: string) => string;

  getName: (name: string) => string;

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createLoader: (opts: any) => Promise<BaseLoader>;
}

// ==========================================================================
export type WACZFileInitOptions = {
  waczname?: string;
  hash?: string;
  path?: string;
  parent?: WACZLoadSource | null;
  fileType?: WACZType;
  crawlId?: string;
  indexType?: IndexType;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entries?: Record<string, any> | null;
  nonSurt?: boolean;
  loader?: BaseLoader | null;
};

// ==========================================================================
export type WACZFileOptions = WACZFileInitOptions & {
  waczname: string;
  hash: string;
};

// ==========================================================================
export class WACZFile implements WACZLoadSource {
  waczname?: string;
  hash?: string;
  path?: string;
  crawlId?: string;
  parent: WACZLoadSource | null;
  fileType: WACZType;
  indexType: IndexType;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entries: Record<string, any> | null;
  nonSurt: boolean;
  loader: BaseLoader | null;
  zipreader: ZipRangeReader | null;

  constructor({
    waczname,
    hash,
    path,
    parent = null,
    entries = null,
    fileType = WACZ_LEAF,
    indexType = INDEX_NOT_LOADED,
    nonSurt = false,
    loader = null,
    crawlId,
  }: WACZFileInitOptions) {
    this.waczname = waczname;
    this.hash = hash;
    this.path = path;
    this.loader = loader;
    this.parent = parent;
    this.zipreader = null;
    this.entries = entries;
    this.indexType = indexType;
    this.fileType = fileType;
    this.nonSurt = nonSurt;
    this.crawlId = crawlId;
  }

  markAsMultiWACZ() {
    this.fileType = MULTI_WACZ;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async init(path?: string): Promise<Record<string, any>> {
    if (path) {
      this.path = path;
    }
    if (this.loader) {
      return await this.initFromLoader(this.loader);
    }
    if (!this.parent) {
      throw new Error("must have either loader or parent");
    }
    const loader = await this.parent.createLoader({ url: this.path });

    return await this.initFromLoader(loader);
  }

  private async initFromLoader(loader: BaseLoader) {
    this.zipreader = new ZipRangeReader(loader, this.entries);

    if (!this.entries) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      this.entries = (await this.zipreader.load()) || {};
    }

    return this.entries;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadFile(filename: string, opts: Record<string, any>): LoadWACZEntry {
    if (!this.zipreader) {
      await this.init();
    }

    return await this.zipreader!.loadFile(filename, opts);
  }

  containsFile(filename: string) {
    return this.entries && !!this.entries[filename];
  }

  getSizeOf(filename: string) {
    return this.zipreader ? this.zipreader.getCompressedSize(filename) : 0;
  }

  serialize() {
    return {
      waczname: this.waczname,
      hash: this.hash,
      path: this.path,
      crawlId: this.crawlId,
      entries: this.entries,
      indexType: this.indexType,
      nonSurt: this.nonSurt,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async save(db: any, always = false) {
    const zipreader = this.zipreader;
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
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

  getLoadPath(path: string) {
    return this.waczname + "#!/" + path;
  }

  getName(name: string) {
    return this.waczname + "#!/" + name;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createLoader(opts: any): Promise<BaseLoader> {
    const { url } = opts;
    const inx = url.lastIndexOf("#!/");

    if (!this.zipreader) {
      await this.init();
    }

    if (inx >= 0) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return new ZipBlockLoader(this.zipreader!, url.slice(inx + 3));
    } else {
      throw new Error("invalid wacz url: " + url);
    }
  }
}
