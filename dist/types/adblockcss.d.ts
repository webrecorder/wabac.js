export declare function getAdBlockCSSResponse(fullDomain: string, adblockUrl: string): Promise<Response>;
export declare class ByLineTransform {
    _buffer: string[];
    _lastChunkEndedWithCR: boolean;
    decoder: TextDecoder;
    transform(chunkArray: Uint8Array, controller: TransformStreamDefaultController): void;
    flush(controller: TransformStreamDefaultController): void;
}
export declare class ByLineStream extends TransformStream<Uint8Array, string> {
    constructor();
}
//# sourceMappingURL=adblockcss.d.ts.map