import { type BaseLoader } from "../blockloaders";
import { type LoadWACZEntry, ZipRangeReader } from "./ziprangereader";
export declare const NO_LOAD_WACZ = "local";
export declare const DEFAULT_WACZ = "default";
export type IndexType = 0 | 1 | 2;
export declare const INDEX_NOT_LOADED = 0;
export declare const INDEX_CDX = 1;
export declare const INDEX_IDX = 2;
export type WACZType = "wacz" | "multi-wacz";
export declare const WACZ_LEAF = "wacz";
export declare const MULTI_WACZ = "multi-wacz";
export interface WACZLoadSource {
    getLoadPath: (path: string) => string;
    getName: (name: string) => string;
    createLoader: (opts: any) => Promise<BaseLoader>;
}
export type WACZFileInitOptions = {
    waczname?: string;
    hash?: string;
    path?: string;
    parent?: WACZLoadSource | null;
    fileType?: WACZType;
    crawlId?: string;
    indexType?: IndexType;
    entries?: Record<string, any> | null;
    nonSurt?: boolean;
    loader?: BaseLoader | null;
};
export type WACZFileOptions = WACZFileInitOptions & {
    waczname: string;
    hash: string;
};
export declare class WACZFile implements WACZLoadSource {
    waczname?: string;
    hash?: string;
    path?: string;
    crawlId?: string;
    parent: WACZLoadSource | null;
    fileType: WACZType;
    indexType: IndexType;
    entries: Record<string, any> | null;
    nonSurt: boolean;
    loader: BaseLoader | null;
    zipreader: ZipRangeReader | null;
    constructor({ waczname, hash, path, parent, entries, fileType, indexType, nonSurt, loader, crawlId, }: WACZFileInitOptions);
    markAsMultiWACZ(): void;
    init(path?: string): Promise<Record<string, any>>;
    private initFromLoader;
    loadFile(filename: string, opts: Record<string, any>): LoadWACZEntry;
    containsFile(filename: string): boolean | null;
    getSizeOf(filename: string): number;
    serialize(): {
        waczname: string | undefined;
        hash: string | undefined;
        path: string | undefined;
        crawlId: string | undefined;
        entries: Record<string, any> | null;
        indexType: IndexType;
        nonSurt: boolean;
    };
    save(db: any, always?: boolean): Promise<void>;
    iterContainedFiles(): string[];
    getLoadPath(path: string): string;
    getName(name: string): string;
    createLoader(opts: any): Promise<BaseLoader>;
}
//# sourceMappingURL=waczfile.d.ts.map