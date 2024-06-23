/// <reference types="web" />
export declare class ArchiveRequest {
    url: string;
    timestamp: string;
    mod: string;
    pageId: string;
    hash: string;
    cookie: string;
    request: Request;
    method: string;
    mode: string;
    _postToGetConverted: boolean;
    constructor(wbUrlStr: string, request: Request, { isRoot, mod, ts, proxyOrigin, localOrigin }?: {
        isRoot?: boolean | undefined;
        mod?: string | undefined;
        ts?: string | undefined;
        proxyOrigin?: null | undefined;
        localOrigin?: null | undefined;
    });
    get headers(): Headers;
    get destination(): RequestDestination;
    get referrer(): string;
    convertPostToGet(): Promise<string>;
    prepareProxyRequest(prefix: string, isLive?: boolean): {
        referrer: any;
        headers: any;
        credentials: any;
        url: string;
    };
    getBody(): Promise<Uint8Array>;
}
//# sourceMappingURL=request.d.ts.map