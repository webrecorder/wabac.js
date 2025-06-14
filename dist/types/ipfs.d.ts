export declare function initAutoIPFS(opts: Record<string, any>): Promise<{
    get: (url: string, opts: {
        start?: number;
        offset?: number;
        end?: number;
        signal?: AbortSignal | null;
    }) => AsyncIterable<Uint8Array>;
    getSize: (url: string) => number | null;
}>;
//# sourceMappingURL=ipfs.d.ts.map