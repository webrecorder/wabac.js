export type ResponseAbort = {
    response: Response;
    abort: AbortController | null;
};
export declare function createLoader(opts: any): Promise<BaseLoader>;
export declare abstract class BaseLoader {
    canLoadOnDemand: boolean;
    headers: Record<string, string> | null;
    length: number | null;
    constructor(canLoadOnDemand: boolean);
    abstract doInitialFetch(tryHead: boolean, skipRange: boolean): Promise<ResponseAbort>;
    abstract getLength(): Promise<number>;
    abstract getRange(offset: number, length: number, streaming: boolean, signal?: AbortSignal | null): Promise<Uint8Array | ReadableStream<Uint8Array>>;
    abstract get isValid(): boolean;
}
export declare function getReadableStreamFromIter(stream: any): ReadableStream<any>;
export declare function getReadableStreamFromArray(array: any): ReadableStream<any>;
//# sourceMappingURL=blockloaders.d.ts.map