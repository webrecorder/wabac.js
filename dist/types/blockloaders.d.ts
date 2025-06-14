export type ResponseAbort = {
    response: Response;
    abort: AbortController | null;
};
export type BlockLoaderExtra = {
    arrayBuffer?: Uint8Array;
    publicUrl?: string;
    fileHandle?: FileSystemFileHandle;
};
export type BlockLoaderOpts = {
    url: string;
    headers?: Record<string, string> | Headers;
    extra?: BlockLoaderExtra;
    size?: number;
    blob?: Blob;
};
export declare function createLoader(opts: BlockLoaderOpts): Promise<BaseLoader>;
export declare abstract class BaseLoader {
    canLoadOnDemand: boolean;
    headers: Record<string, string> | Headers;
    length: number | null;
    canDoNegativeRange: boolean;
    constructor(canLoadOnDemand: boolean);
    abstract doInitialFetch(tryHead: boolean, skipRange: boolean): Promise<ResponseAbort>;
    abstract getLength(): Promise<number>;
    abstract getRange(offset: number, length: number, streaming: boolean, signal?: AbortSignal | null): Promise<Uint8Array | ReadableStream<Uint8Array>>;
    abstract get isValid(): boolean;
    getRangeFromEnd(length: number, streaming: boolean, signal?: AbortSignal | null): Promise<Uint8Array | ReadableStream<Uint8Array>>;
    getFullBuffer(): Uint8Array | null;
}
export declare function getReadableStreamFromIter(stream: AsyncIterable<Uint8Array>): ReadableStream<any>;
export declare function getReadableStreamFromArray(array: Uint8Array): ReadableStream<any>;
//# sourceMappingURL=blockloaders.d.ts.map