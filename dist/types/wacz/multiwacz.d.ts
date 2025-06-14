import { type LoadRecordFromSourceType, OnDemandPayloadArchiveDB } from "../remotearchivedb";
import { LiveProxy } from "../liveproxy";
import { type IDBPTransaction, type IDBPDatabase } from "idb";
import { WACZFile, type WACZFileInitOptions, type WACZFileOptions, type WACZLoadSource } from "./waczfile";
import { type ADBType } from "../archivedb";
import { type BaseLoader, type BlockLoaderOpts } from "../blockloaders";
import { type ArchiveResponse } from "../response";
import { type ArchiveRequest } from "../request";
import { type LoadWACZEntry } from "./ziprangereader";
import { type WACZPageEntry, type MultiWACZJsonSpec, type PageEntry, type RemoteResourceEntry, type WACZCollConfig } from "../types";
export type IDXLine = {
    waczname: string;
    prefix: string;
    filename: string;
    offset: number;
    length: number;
    digest?: string;
    loaded: boolean;
};
interface MDBType extends ADBType {
    ziplines: {
        key: [string, string];
        value: unknown;
    };
    waczfiles: {
        key: string;
        value: unknown;
    };
    verification: {
        key: string;
        value: unknown;
    };
}
export declare class MultiWACZ extends OnDemandPayloadArchiveDB implements WACZLoadSource {
    config: WACZCollConfig;
    waczfiles: Record<string, WACZFile>;
    waczNameForHash: Record<string, string>;
    ziploadercache: Record<string, Promise<void>>;
    updating: Promise<void> | null;
    rootSourceType: "wacz" | "json";
    sourceLoader: BaseLoader | undefined;
    externalSource: LiveProxy | null;
    textIndex: string;
    fuzzyUrlRules: {
        match: RegExp;
        replace: any;
    }[];
    pagesQueryUrl: string;
    referrerMap: Map<string, string>;
    notAPage: Set<string>;
    maxFallbackLookups: number;
    totalPages?: number;
    preloadResources: string[];
    seedPageWACZs: Map<string, Set<string>>;
    constructor(config: WACZCollConfig, sourceLoader: BaseLoader, rootSourceType?: "wacz" | "json");
    initConfig(extraConfig: NonNullable<WACZCollConfig["extraConfig"]>): void;
    updateHeaders(headers: Record<string, string>): void;
    _initDB(db: IDBPDatabase<MDBType>, oldV: number, newV: number, tx: IDBPTransaction<MDBType, (keyof MDBType)[], "readwrite" | "versionchange">): void;
    convertV2WACZDB(db: any, tx: any): Promise<void>;
    addWACZFile(file: WACZFileOptions): WACZFile;
    init(): Promise<void>;
    close(): Promise<void>;
    clearZipData(): Promise<void>;
    addVerifyData(prefix: string | undefined, id: string, expected: string, actual?: string | null, log?: boolean): Promise<void>;
    addVerifyDataList(prefix: string, datalist: any[]): Promise<void>;
    getVerifyInfo(): Promise<Record<string, any>>;
    getVerifyExpected(id: string): Promise<any>;
    clearAll(): Promise<void>;
    loadRecordFromSource(cdx: RemoteResourceEntry): LoadRecordFromSourceType;
    loadIndex(waczname: string): Promise<{
        indexType: number;
        isNew: boolean;
    }>;
    loadCDX(filename: string, waczname: string, progressUpdate?: any, total?: number): Promise<{}>;
    loadIDX(filename: string, waczname: string, progressUpdate?: any, total?: number): Promise<void>;
    loadCDXFromIDX(waczname: string, url: string, datetime?: number, isPrefix?: boolean): Promise<boolean>;
    doCDXLoad(cacheKey: string, zipblock: IDXLine, waczname: string): Promise<void>;
    findPageAtUrl(url: string, ts: number): Promise<(PageEntry & {
        size?: number;
    }) | null>;
    lookupUrl(url: string, datetime: number, opts?: Record<string, any>): Promise<import("../types").ResourceEntry | null>;
    lookupUrlForWACZ(waczname: string, url: string, datetime: number, opts: Record<string, any>): Promise<import("../types").ResourceEntry | null>;
    resourcesByUrlAndMime(url: string, ...args: [string, number, boolean, string, string]): Promise<import("../types").ResAPIResponse[]>;
    loadFileFromWACZ(waczfile: WACZFile, filename: string, opts: Record<string, any>, numRetries?: number): LoadWACZEntry;
    loadFileFromNamedWACZ(waczname: string, filename: string, opts: Record<string, any>): LoadWACZEntry;
    computeFileHash(waczname: string, hash?: string): Promise<string>;
    addNewWACZ({ name, hash, path, crawlId, parent, loader, }: WACZFileInitOptions & {
        name: string;
    }): Promise<Record<string, any>>;
    loadWACZFiles(json: MultiWACZJsonSpec, parent?: WACZLoadSource): Promise<void>;
    addInitialPages(pagesImport: WACZPageEntry[]): Promise<void>;
    getTextIndex(): Promise<Response>;
    getResource(request: ArchiveRequest, prefix: string, event: FetchEvent, { pageId, noRedirect }?: Record<string, any>): Promise<ArchiveResponse | Response | null>;
    retryLoad(e: any): Promise<boolean>;
    queryPages(search?: string, page?: number, pageSize?: number): Promise<{
        pages: Record<string, any>[];
        total: number;
    }>;
    getWACZFilesToTry(request: ArchiveRequest, waczname: string | null): Promise<string[]>;
    getWACZFilesForPagesQuery(requestUrl: string): Promise<string[] | null>;
    checkUpdates(): Promise<void>;
    loadFromJSON(response?: Response | null): Promise<MultiWACZJsonSpec>;
    getLoadPath(path: string): string;
    getName(name: string): string;
    createLoader(opts: BlockLoaderOpts): Promise<BaseLoader>;
}
export {};
//# sourceMappingURL=multiwacz.d.ts.map