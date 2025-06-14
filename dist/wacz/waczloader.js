import { MAX_FULL_DOWNLOAD_SIZE } from "../utils";
import { WARCLoader } from "../warcloader";
import { DEFAULT_WACZ, WACZFile } from "./waczfile";
import { WACZImporter } from "./waczimporter";
// ============================================================================
export class SingleWACZLoader {
    loader;
    loadId = null;
    loadUrl;
    constructor(loader, config, loadId = null) {
        this.loader = loader;
        this.loadId = loadId;
        this.loadUrl = config.loadUrl;
    }
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async load(db /*progressUpdate, fullTotalSize*/) {
        // if size less than MAX_FULL_DOWNLOAD_SIZE
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loader = this.loader;
        if (db.fullConfig &&
            loader.arrayBuffer &&
            loader.arrayBuffer.byteLength <= MAX_FULL_DOWNLOAD_SIZE) {
            if (!db.fullConfig.extra) {
                db.fullConfig.extra = {};
            }
            db.fullConfig.extra.arrayBuffer = loader.arrayBuffer;
        }
        const name = DEFAULT_WACZ;
        const path = this.loadUrl;
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await db.addNewWACZ({ name, path, loader });
    }
}
// ==========================================================================
export class SingleWACZFullImportLoader {
    loader;
    loadId = null;
    config;
    constructor(loader, config, loadId = null) {
        this.config = config;
        this.loadId = loadId;
        this.loader = loader;
    }
    async load(
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db, progressUpdateCallback = // [TODO]
     null, fullTotalSize = 0) {
        const file = new WACZFile({ loader: this.loader });
        await file.init();
        const zipreader = file.zipreader;
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const importer = new WACZImporter(db, file);
        const metadata = await importer.load();
        let offsetTotal = 0;
        const progressUpdate = (percent, error, offset /*, total*/) => {
            offset += offsetTotal;
            if (progressUpdateCallback && fullTotalSize) {
                progressUpdateCallback(Math.round((offset * 100.0) / fullTotalSize), null, offset, fullTotalSize);
            }
        };
        // load CDX and IDX
        for (const filename of file.iterContainedFiles()) {
            const entryTotal = zipreader.getCompressedSize(filename);
            if (filename.endsWith(".warc.gz") || filename.endsWith(".warc")) {
                await this.loadWARC(db, zipreader, filename, progressUpdate, entryTotal);
            }
            offsetTotal += entryTotal;
        }
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return metadata || {};
    }
    async loadWARC(
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db, zipreader, filename, 
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progressUpdate, total) {
        const { reader } = await zipreader.loadFile(filename, { unzip: true });
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!reader) {
            throw new Error("no WARC found");
        }
        const loader = new WARCLoader(reader, null, filename);
        loader.detectPages = false;
        return await loader.load(db, progressUpdate, total);
    }
}
// ==========================================================================
export class JSONResponseMultiWACZLoader {
    response;
    constructor(response) {
        this.response = response;
    }
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async load(db) {
        try {
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return await db.loadFromJSON(this.response);
        }
        catch (_) {
            return {};
        }
    }
}
//# sourceMappingURL=waczloader.js.map