import { type BaseLoader } from "../blockloaders";
import { type CollConfig, type ArchiveLoader } from "../types";
import { type ZipRangeReader } from "./ziprangereader";
export declare class SingleWACZLoader implements ArchiveLoader {
    loader: BaseLoader;
    loadId: string | null;
    loadUrl: string;
    constructor(loader: BaseLoader, config: CollConfig, loadId?: string | null);
    load(db: any): Promise<any>;
}
export declare class SingleWACZFullImportLoader implements ArchiveLoader {
    loader: BaseLoader;
    loadId: string | null;
    config: CollConfig;
    constructor(loader: BaseLoader, config: CollConfig, loadId?: string | null);
    load(db: any, progressUpdateCallback?: ((prog: number, x: any, offset: number, size: number) => void) | null, fullTotalSize?: number): Promise<any>;
    loadWARC(db: any, zipreader: ZipRangeReader, filename: string, progressUpdate: any, total: number): Promise<import("../types").CollMetadata>;
}
export declare class JSONResponseMultiWACZLoader implements ArchiveLoader {
    response: Response;
    constructor(response: Response);
    load(db: any): Promise<any>;
}
//# sourceMappingURL=waczloader.d.ts.map