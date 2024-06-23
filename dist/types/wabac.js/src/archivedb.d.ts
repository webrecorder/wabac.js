/// <reference types="web" />
import { IDBPDatabase } from "idb/with-async-ittr";
import { ArchiveResponse } from "./response.js";
declare class ArchiveDB {
    name: string;
    minDedupSize: number;
    version: number;
    autoHttpsCheck: boolean;
    useRefCounts: boolean;
    allowRepeats: boolean;
    repeatTracker: RepeatTracker | null;
    fuzzyPrefixSearch: boolean;
    initing: Promise<void>;
    db: IDBPDatabase | null;
    constructor(name: any, opts?: any);
    init(): Promise<void>;
    _initDB(db: any, oldV: any, newV: any, tx: any): void;
    clearAll(): Promise<void>;
    close(): void;
    delete(): Promise<void>;
    addPage(page: any, tx: any): Promise<any>;
    addPages(pages: any, pagesTable?: string, update?: boolean): Promise<void>;
    createPageList(data: any): Promise<IDBValidKey>;
    addCuratedPageList(listInfo: any, pages: any): Promise<void>;
    addCuratedPageLists(pageLists: any, pageKey?: string, filter?: string): Promise<void>;
    convertCuratedPagesToV2(db: any): Promise<void>;
    getCuratedPagesByList(): Promise<any[]>;
    newPageId(): string;
    getAllPages(): Promise<any[]>;
    getPages(pages: any): Promise<never[]>;
    getTimestampsByURL(url: any): Promise<never[]>;
    getPagesWithState(state: any): Promise<any[]>;
    getVerifyInfo(): Promise<{}>;
    addVerifyData(): Promise<void>;
    addVerifyDataList(): Promise<void>;
    dedupResource(digest: any, payload: any, tx: any, count?: number): Promise<any>;
    addResources(datas: any): Promise<void>;
    getFuzzyUrl(result: any): {
        url: any;
        ts: any;
        origURL: any;
        origTS: any;
        pageId: any;
        digest: any;
    } | null;
    addResource(data: any): Promise<boolean>;
    getResource(request: any, rwPrefix: any, event: any, opts?: {}): Promise<ArchiveResponse | null>;
    loadPayload(result: any): Promise<any>;
    isSelfRedirect(url: any, result: any): boolean;
    lookupUrl(url: any, ts: any, opts?: {}): Promise<any>;
    lookupQueryPrefix(url: any, opts: any): Promise<any>;
    resJson(res: any): {
        url: any;
        date: string;
        ts: string;
        mime: any;
        status: any;
    };
    resourcesByPage(pageId: any): Promise<any[]>;
    resourcesByPages2(pageIds: any): AsyncGenerator<any, void, unknown>;
    resourcesByPages(pageIds: any): AsyncGenerator<any, void, unknown>;
    matchAny(storeName: string, indexName: string, sortedKeys: string, subKey: string, openBound?: boolean): AsyncGenerator<any, void, unknown>;
    resourcesByUrlAndMime(url: string, mimes: string, count?: number, prefix?: boolean, fromUrl?: string, fromTs?: string): Promise<never[]>;
    resourcesByMime(mimes: any, count?: number, fromMime?: string, fromUrl?: string, fromStatus?: number): Promise<never[]>;
    deletePage(id: any): Promise<{
        pageSize: any;
        dedupSize: number;
    }>;
    deletePageResources(pageId: any): Promise<number>;
    prefixUpperBound(url: any): string;
    getLookupRange(url: any, type: any, fromUrl: any, fromTs: any): IDBKeyRange;
}
declare class RepeatTracker {
    constructor();
    getSkipCount(event: any, url: any, method: any): any;
}
export { ArchiveDB };
//# sourceMappingURL=archivedb.d.ts.map