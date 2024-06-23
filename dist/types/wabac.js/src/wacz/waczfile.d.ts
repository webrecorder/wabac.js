export const NO_LOAD_WACZ: "local";
export const DEFAULT_WACZ: "default";
export const INDEX_NOT_LOADED: 0;
export const INDEX_CDX: 1;
export const INDEX_IDX: 2;
export const WACZ_LEAF: "wacz";
export const MULTI_WACZ: "multi-wacz";
export class WACZFile extends WACZLoadSource {
    constructor({ waczname, hash, path, parent, entries, fileType, indexType, nonSurt, loader }?: {
        waczname: any;
        hash: any;
        path: any;
        parent?: null | undefined;
        entries?: null | undefined;
        fileType?: string | undefined;
        indexType?: number | undefined;
        nonSurt?: boolean | undefined;
        loader?: null | undefined;
    });
    waczname: any;
    hash: any;
    path: any;
    loader: any;
    parent: any;
    zipreader: any;
    entries: any;
    indexType: number;
    fileType: string;
    nonSurt: boolean;
    markAsMultiWACZ(): void;
    init(path: any): Promise<any>;
    initFromLoader(loader: any): Promise<any>;
    loadFile(filename: any, opts: any): Promise<any>;
    containsFile(filename: any): boolean;
    getSizeOf(filename: any): any;
    serialize(): {
        waczname: any;
        hash: any;
        path: any;
        entries: any;
        indexType: number;
        nonSurt: boolean;
    };
    save(db: any, always?: boolean): Promise<void>;
    iterContainedFiles(): string[];
    getLoadPath(path: any): string;
    getName(name: any): string;
    createLoader(opts: any): Promise<ZipBlockLoader | undefined>;
}
declare class WACZLoadSource {
    getLoadPath(): void;
    getName(): void;
    createLoader(): Promise<void>;
}
import { ZipBlockLoader } from "./ziprangereader.js";
export {};
//# sourceMappingURL=waczfile.d.ts.map