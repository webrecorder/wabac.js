import { ZipBlockLoader, ZipRangeReader, } from "./ziprangereader";
export const NO_LOAD_WACZ = "local";
export const DEFAULT_WACZ = "default";
export const INDEX_NOT_LOADED = 0;
export const INDEX_CDX = 1;
export const INDEX_IDX = 2;
export const WACZ_LEAF = "wacz";
export const MULTI_WACZ = "multi-wacz";
// ==========================================================================
export class WACZFile {
    waczname;
    hash;
    path;
    crawlId;
    parent;
    fileType;
    indexType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entries;
    nonSurt;
    loader;
    zipreader;
    constructor({ waczname, hash, path, parent = null, entries = null, fileType = WACZ_LEAF, indexType = INDEX_NOT_LOADED, nonSurt = false, loader = null, crawlId, }) {
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
    async init(path) {
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
    async initFromLoader(loader) {
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
    async loadFile(filename, opts) {
        if (!this.zipreader) {
            await this.init();
        }
        return await this.zipreader.loadFile(filename, opts);
    }
    containsFile(filename) {
        return this.entries && !!this.entries[filename];
    }
    getSizeOf(filename) {
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
    async save(db, always = false) {
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
    getLoadPath(path) {
        return this.waczname + "#!/" + path;
    }
    getName(name) {
        return this.waczname + "#!/" + name;
    }
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async createLoader(opts) {
        const { url } = opts;
        const inx = url.lastIndexOf("#!/");
        if (!this.zipreader) {
            await this.init();
        }
        if (inx >= 0) {
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            return new ZipBlockLoader(this.zipreader, url.slice(inx + 3));
        }
        else {
            throw new Error("invalid wacz url: " + url);
        }
    }
}
//# sourceMappingURL=waczfile.js.map