export type ArchiveRequestInitOpts = {
    isRoot?: boolean;
    mod?: string;
    ts?: string;
    proxyOrigin?: string;
    localOrigin?: string;
    proxyTLD?: string;
    localTLD?: string;
    defaultReplayMode?: boolean;
};
export declare class ArchiveRequest {
    url: string;
    timestamp: string;
    mod: string;
    pageId: string;
    hash: string;
    cookie: string;
    isProxyOrigin: boolean;
    proxyOrigin?: string;
    proxyScheme: string;
    localOrigin?: string;
    httpToHttpsNeeded: boolean;
    proxyTLD?: string;
    localTLD?: string;
    request: Request;
    method: string;
    mode: string;
    private _proxyReferrer;
    _postToGetConverted: boolean;
    constructor(wbUrlStr: string, request: Request, { isRoot, mod, ts, proxyOrigin, localOrigin, proxyTLD, localTLD, defaultReplayMode, }?: ArchiveRequestInitOpts);
    get headers(): Headers;
    get destination(): RequestDestination;
    get referrer(): string;
    convertPostToGet(): Promise<string>;
    prepareProxyRequest(prefix: string, isLive?: boolean): {
        referrer?: string;
        headers: Headers;
        credentials: RequestCredentials;
        url: string;
    };
    getBody(): Promise<Uint8Array>;
}
export declare function resolveFullUrlFromReferrer(url: string, referrer: string): string | null;
//# sourceMappingURL=request.d.ts.map