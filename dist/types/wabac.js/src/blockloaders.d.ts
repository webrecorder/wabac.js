type ResponseAbort = {
    response: Response | null;
    abort: AbortController | null;
};
declare function createLoader(opts: any): Promise<ArrayBufferLoader | BlobCacheLoader | FetchRangeLoader | FileHandleLoader | GoogleDriveLoader | IPFSRangeLoader>;
export declare abstract class BaseLoader {
    canLoadOnDemand: boolean;
    constructor(canLoadOnDemand: boolean);
    abstract getLength(): Promise<number>;
    abstract getRange(offset: number, length: number, streaming: boolean, signal?: AbortSignal | null): Promise<Uint8Array | ReadableStream<Uint8Array>>;
}
declare class FetchRangeLoader extends BaseLoader {
    url: string;
    headers: Record<string, string>;
    length: number | null;
    isValid: boolean;
    ipfsAPI: null;
    loadingIPFS: null;
    constructor({ url, headers, length, canLoadOnDemand }: {
        url: string;
        headers?: Record<string, string>;
        length?: number | null;
        canLoadOnDemand?: boolean;
    });
    doInitialFetch(tryHead: any, skipRange?: boolean): Promise<{
        response: Response | null;
        abort: AbortController | null;
    }>;
    getLength(): Promise<number>;
    getRange(offset: number, length: number, streaming?: boolean, signal?: AbortSignal | null): Promise<Uint8Array | ReadableStream<Uint8Array>>;
    retryFetch(url: any, options: any): Promise<Response>;
}
declare class GoogleDriveLoader extends BaseLoader {
    fileId: string;
    apiUrl: string;
    headers: Record<string, string>;
    length: number;
    publicUrl: string | null;
    isValid: boolean;
    constructor({ url, headers, size, extra }: {
        url: any;
        headers: any;
        size: any;
        extra: any;
    });
    getLength(): Promise<number>;
    doInitialFetch(tryHead: any): Promise<ResponseAbort | null>;
    getRange(offset: number, length: number, streaming: boolean | undefined, signal: AbortSignal): Promise<Uint8Array | ReadableStream<Uint8Array>>;
    refreshPublicUrl(): Promise<boolean>;
}
declare class ArrayBufferLoader extends BaseLoader {
    arrayBuffer: Uint8Array;
    size: number;
    constructor(arrayBuffer: any);
    get length(): number;
    get isValid(): boolean;
    getLength(): Promise<number>;
    doInitialFetch(tryHead?: boolean): Promise<{
        response: Response;
    }>;
    getRange(offset: any, length: any, streaming?: boolean): Promise<Uint8Array | ReadableStream<any>>;
}
declare class BlobCacheLoader extends BaseLoader {
    url: string;
    blob: Blob | null;
    size: number;
    arrayBuffer: Uint8Array | null;
    constructor({ url, blob, size }: {
        url: string;
        blob: Blob | null;
        size: number | null;
    });
    get length(): number;
    get isValid(): boolean;
    getLength(): Promise<number>;
    doInitialFetch(tryHead?: boolean): Promise<{
        response: Response;
    }>;
    getRange(offset: any, length: any, streaming?: boolean): Promise<Uint8Array | ReadableStream<any>>;
    _getArrayBuffer(): Promise<ArrayBuffer>;
}
declare class FileHandleLoader extends BaseLoader {
    url: string;
    file: Blob | null;
    size: number;
    fileHandle: FileSystemFileHandle;
    constructor({ blob, size, extra, url }: {
        blob?: Blob;
        size: number;
        extra: any;
        url: string;
    });
    get length(): number;
    get isValid(): boolean;
    getLength(): Promise<number>;
    initFileObject(): Promise<void>;
    doInitialFetch(tryHead?: boolean): Promise<{
        response: Response;
    }>;
    getRange(offset: any, length: any, streaming?: boolean): Promise<Uint8Array | ReadableStream<Uint8Array>>;
}
declare class IPFSRangeLoader extends BaseLoader {
    url: string;
    opts: Record<string, any>;
    headers: Headers | null;
    length: number | null;
    isValid: boolean;
    constructor({ url, headers, ...opts }: {
        [x: string]: any;
        url: any;
        headers: any;
    });
    getLength(): Promise<number>;
    doInitialFetch(tryHead: any): Promise<{
        response: Response;
        abort: AbortController;
    }>;
    getRange(offset: number, length: number, streaming?: boolean, signal?: AbortSignal | null): Promise<Uint8Array | ReadableStream<any>>;
}
export declare function getReadableStreamFromIter(stream: any): ReadableStream<any>;
export declare function getReadableStreamFromArray(array: any): ReadableStream<any>;
export { createLoader };
//# sourceMappingURL=blockloaders.d.ts.map