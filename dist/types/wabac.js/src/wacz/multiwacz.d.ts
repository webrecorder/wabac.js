export class MultiWACZ extends OnDemandPayloadArchiveDB {
    constructor(config: any, sourceLoader: any, rootSourceType?: string);
    config: any;
    waczfiles: {};
    waczNameForHash: {};
    ziploadercache: {};
    updating: Promise<void> | null;
    rootSourceType: string;
    sourceLoader: any;
    externalSource: LiveProxy | null;
    fuzzyUrlRules: any[];
    textIndex: any;
    initConfig(extraConfig: any): void;
    updateHeaders(headers: any): void;
    _initDB(db: any, oldV: any, newV: any, tx: any): void;
    convertV2WACZDB(db: any, tx: any): Promise<void>;
    addWACZFile(file: any): any;
    close(): Promise<void>;
    clearZipData(): Promise<void>;
    addVerifyData(prefix: string | undefined, id: any, expected: any, actual: any, log?: boolean): Promise<void>;
    addVerifyDataList(prefix: any, datalist: any): Promise<void>;
    getVerifyInfo(): Promise<{
        numInvalid: number;
        numValid: number;
    }>;
    getVerifyExpected(id: any): Promise<any>;
    loadRecordFromSource(cdx: any): Promise<{
        remote: import("../baseparser.js").ResourceEntry | null;
        hasher: any;
    }>;
    loadIndex(waczname: any): Promise<{
        indexType: any;
        isNew: boolean;
    }>;
    loadCDX(filename: any, waczname: any, progressUpdate: any, total: any): Promise<void>;
    loadIDX(filename: any, waczname: any, progressUpdate: any, total: any): Promise<void>;
    loadCDXFromIDX(waczname: any, url: any, datetime?: number, isPrefix?: boolean): Promise<boolean>;
    doCDXLoad(cacheKey: any, zipblock: any, waczname: any): Promise<void>;
    findPageAtUrl(url: any, ts: any): Promise<any>;
    lookupUrl(url: any, datetime: any, opts?: {}): Promise<any>;
    lookupUrlForWACZ(waczname: any, url: any, datetime: any, opts: any): Promise<any>;
    resourcesByUrlAndMime(url: any, ...args: any[]): Promise<any[]>;
    loadFileFromWACZ(waczfile: any, filename: any, opts: any): Promise<any>;
    loadFileFromNamedWACZ(waczname: any, filename: any, opts: any): Promise<any>;
    addNewWACZ({ name, hash, path, parent, loader }?: {
        name: any;
        hash: any;
        path: any;
        parent?: null | undefined;
        loader?: null | undefined;
    }): Promise<any>;
    loadWACZFiles(json: any, parent?: this): Promise<void>;
    getTextIndex(): Promise<Response>;
    getResource(request: any, prefix: any, event: any, { pageId }?: {
        pageId: any;
    }): Promise<import("../response.js").ArchiveResponse | Response | null>;
    retryLoad(e: any): Promise<boolean>;
    checkUpdates(): Promise<void>;
    loadFromJSON(response?: null): Promise<any>;
    getLoadPath(path: any): string;
    getName(name: any): any;
    createLoader(opts: any): Promise<{
        arrayBuffer: Uint8Array;
        size: number;
        readonly length: number;
        readonly isValid: boolean;
        getLength(): Promise<number>;
        doInitialFetch(tryHead?: boolean): Promise<{
            response: Response;
        }>;
        getRange(offset: any, length: any, streaming?: boolean): Promise<Uint8Array | ReadableStream<any>>;
        canLoadOnDemand: boolean;
    } | {
        url: string;
        blob: Blob | null;
        size: number;
        arrayBuffer: Uint8Array | null;
        readonly length: number;
        readonly isValid: boolean;
        getLength(): Promise<number>;
        doInitialFetch(tryHead?: boolean): Promise<{
            response: Response;
        }>;
        getRange(offset: any, length: any, streaming?: boolean): Promise<Uint8Array | ReadableStream<any>>;
        _getArrayBuffer(): Promise<ArrayBuffer>;
        canLoadOnDemand: boolean;
    } | {
        url: string;
        headers: Record<string, string>;
        length: number | null;
        isValid: boolean;
        ipfsAPI: null;
        loadingIPFS: null;
        doInitialFetch(tryHead: any, skipRange?: boolean): Promise<{
            response: Response | null;
            abort: AbortController | null;
        }>;
        getLength(): Promise<number>;
        getRange(offset: number, length: number, streaming?: boolean, signal?: AbortSignal | null): Promise<Uint8Array | ReadableStream<Uint8Array>>;
        retryFetch(url: any, options: any): Promise<Response>;
        canLoadOnDemand: boolean;
    } | {
        url: string;
        file: Blob | null;
        size: number;
        fileHandle: FileSystemFileHandle;
        readonly length: number;
        readonly isValid: boolean;
        getLength(): Promise<number>;
        initFileObject(): Promise<void>;
        doInitialFetch(tryHead?: boolean): Promise<{
            response: Response;
        }>;
        getRange(offset: any, length: any, streaming?: boolean): Promise<Uint8Array | ReadableStream<Uint8Array>>;
        canLoadOnDemand: boolean;
    } | {
        fileId: string;
        apiUrl: string;
        headers: Record<string, string>;
        length: number;
        publicUrl: string | null;
        isValid: boolean;
        getLength(): Promise<number>;
        doInitialFetch(tryHead: any): Promise<{
            response: Response | null;
            abort: AbortController | null;
        } | null>;
        getRange(offset: number, length: number, streaming: boolean | undefined, signal: AbortSignal): Promise<Uint8Array | ReadableStream<Uint8Array>>;
        refreshPublicUrl(): Promise<boolean>;
        canLoadOnDemand: boolean;
    } | {
        url: string;
        opts: Record<string, any>;
        headers: Headers | null;
        length: number | null;
        isValid: boolean;
        getLength(): Promise<number>;
        doInitialFetch(tryHead: any): Promise<{
            response: Response;
            abort: AbortController;
        }>;
        getRange(offset: number, length: number, streaming?: boolean, signal?: AbortSignal | null): Promise<Uint8Array | ReadableStream<any>>;
        canLoadOnDemand: boolean;
    }>;
}
import { OnDemandPayloadArchiveDB } from "../remotearchivedb.js";
import { LiveProxy } from "../liveproxy.js";
//# sourceMappingURL=multiwacz.d.ts.map