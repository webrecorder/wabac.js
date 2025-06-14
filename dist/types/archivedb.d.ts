import { type IDBPDatabase, type IDBPTransaction } from "idb/with-async-ittr";
import { ArchiveResponse } from "./response";
import { type DBStore, type DigestRefCount, type PageEntry, type ResAPIResponse, type ResourceEntry } from "./types";
import { type ArchiveRequest } from "./request";
import { type BaseAsyncIterReader } from "warcio";
export type ADBOpts = {
    minDedupSize?: number | undefined;
    noRefCounts?: unknown;
    noFuzzyCheck?: boolean;
    noRevisits?: boolean;
    pageId?: string;
};
export type ADBType = {
    pages: {
        key: string;
        value: PageEntry & {
            size?: number;
        };
        indexes: {
            url: string;
            ts: string;
            state: number;
        };
    };
    pageLists: {
        key: string;
        value: {
            pages?: unknown[];
            show?: boolean;
            title?: string | undefined;
            desc?: string | undefined;
            slug?: string | undefined;
        };
    };
    curatedPages: {
        key: string;
        value: PageEntry;
        indexes: {
            listPages: [string, string];
        };
    };
    resources: {
        key: [string, string];
        value: ResourceEntry;
        indexes: {
            pageId: string;
            mimeStatusUrl: [string, string, string];
        };
    };
    payload: {
        key: string;
        value: {
            digest: string;
            payload: Uint8Array | null;
        };
        indexes: {
            digest: string;
        };
    };
    digestRef: {
        key: string;
        value: DigestRefCount | null;
        indexes: {
            digest: string;
        };
    };
};
export declare class ArchiveDB implements DBStore {
    name: string;
    minDedupSize: number;
    version: number;
    autoHttpsCheck: boolean;
    useRefCounts: boolean;
    allowRepeats: boolean;
    repeatTracker: RepeatTracker | null;
    fuzzyPrefixSearch: boolean;
    initing: Promise<void>;
    db: IDBPDatabase<ADBType> | null;
    constructor(name: string, opts?: ADBOpts | undefined);
    init(): Promise<void>;
    _initDB(db: IDBPDatabase<ADBType>, oldV: number, _newV: number | null, _tx?: IDBPTransaction<ADBType, (keyof ADBType)[], "readwrite" | "versionchange">): void;
    clearAll(): Promise<void>;
    close(): void;
    delete(): Promise<void>;
    addPage(page: PageEntry, tx?: IDBPTransaction<ADBType, [keyof ADBType], "readwrite"> | null): Promise<string>;
    addPages(pages: PageEntry[], pagesTable?: keyof ADBType, update?: boolean): Promise<void>;
    createPageList(data: {
        title?: string;
        desc?: string;
        description?: string;
        id?: string;
        slug?: string;
    }): Promise<string>;
    addCuratedPageList(listInfo: Record<string, unknown>, pages: PageEntry[]): Promise<void>;
    addCuratedPageLists(pageLists: {
        [k: string]: PageEntry[] | undefined;
    }[], pageKey?: string, filter?: string): Promise<void>;
    convertCuratedPagesToV2(db: IDBPDatabase<ADBType & {
        pages: {
            key: string;
            value: {
                page?: PageEntry;
            } & PageEntry;
        };
        curatedPages: {
            key: string;
            value: {
                page?: PageEntry;
            } & PageEntry;
        };
    }>): Promise<void>;
    getCuratedPagesByList(): Promise<{
        pages?: unknown[];
        show?: boolean;
        title?: string | undefined;
        desc?: string | undefined;
        slug?: string | undefined;
    }[]>;
    newPageId(): string;
    getAllPages(): Promise<(PageEntry & {
        size?: number;
    })[]>;
    getPagesByUrl(url: string): Promise<(PageEntry & {
        size?: number;
    })[]>;
    getPages(pages: string[]): Promise<PageEntry[]>;
    getTimestampsByURL(url: string): Promise<string[]>;
    getPagesWithState(state: number): Promise<(PageEntry & {
        size?: number;
    })[]>;
    getVerifyInfo(): Promise<{}>;
    addVerifyData(_prefix: string | undefined, _id: string, _expected: string, _actual?: string | null, _log?: boolean): Promise<void>;
    addVerifyDataList(_prefix: string, _datalist: unknown[]): Promise<void>;
    dedupResource(digest: string, payload: Uint8Array | null | undefined, tx: IDBPTransaction<ADBType, (keyof ADBType)[], "readwrite">, count?: number): Promise<DigestRefCount | null>;
    addResources(datas: ResourceEntry[]): Promise<void>;
    getFuzzyUrl(result: ResourceEntry): ResourceEntry | null;
    addResource(data: ResourceEntry): Promise<boolean>;
    getResource(request: ArchiveRequest, _prefix: string, event: FetchEvent, opts?: ADBOpts): Promise<ArchiveResponse | Response | null>;
    loadPayload(result: ResourceEntry, _opts: ADBOpts): Promise<BaseAsyncIterReader | Uint8Array | null>;
    isSelfRedirect(url: string, result: ResourceEntry | undefined): boolean;
    lookupUrl(url: string, ts?: number, opts?: ADBOpts): Promise<ResourceEntry | null>;
    lookupQueryPrefix(url: string, opts: ADBOpts): Promise<ResourceEntry | null>;
    resJson(res: ResourceEntry): ResAPIResponse;
    resourcesByPage(pageId: string): Promise<ResourceEntry[]>;
    resourcesByPages2(pageIds: string[]): AsyncGenerator<ResourceEntry, void, unknown>;
    resourcesByPages(pageIds: string[]): AsyncGenerator<ResourceEntry, void, unknown>;
    matchAny<S extends keyof ADBType>(storeName: S, indexName: ADBType[S] extends {
        indexes: {};
    } ? keyof ADBType[S]["indexes"] | null : null, sortedKeys: string[], subKey?: number, openBound?: boolean): AsyncGenerator<ADBType[S]["value"], void, unknown>;
    resourcesByUrlAndMime(url: string, mimes: string, count?: number, prefix?: boolean, fromUrl?: string, fromTs?: string): Promise<ResAPIResponse[]>;
    resourcesByMime(mimesStr: string, count?: number, fromMime?: string, fromUrl?: string, fromStatus?: number): Promise<ResAPIResponse[]>;
    deletePage(id: string): Promise<{
        pageSize: number;
        dedupSize: number;
    }>;
    deletePageResources(pageId: string): Promise<number>;
    prefixUpperBound(url: string): string;
    getLookupRange(url: string, type: string, fromUrl?: string, fromTs?: string): IDBKeyRange;
}
declare class RepeatTracker {
    repeats: Record<string, Record<string, number>>;
    getSkipCount(event: FetchEvent, url: string, method: string): number;
}
export {};
//# sourceMappingURL=archivedb.d.ts.map