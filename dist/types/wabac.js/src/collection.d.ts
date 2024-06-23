export class Collection {
    constructor(opts: any, prefixes: any, defaultConfig?: {});
    name: any;
    store: any;
    config: any;
    metadata: any;
    injectScripts: any;
    noRewritePrefixes: any;
    noPostToGet: boolean;
    convertPostToGet: boolean;
    coHeaders: any;
    csp: any;
    injectRelCanon: any;
    baseFramePrefix: any;
    baseFrameUrl: any;
    baseFrameHashReplay: any;
    liveRedirectOnNotFound: any;
    rootPrefix: any;
    adblockUrl: any;
    prefix: any;
    isRoot: boolean;
    staticPrefix: any;
    handleRequest(request: any, event: any): Promise<any>;
    getCanonRedirect(query: any): Response | null;
    getWrappedModuleDecl(): Response;
    getSrcDocResponse(url: any, base64str: any): ArchiveResponse;
    getBlobResponse(url: any): Promise<ArchiveResponse>;
    getReplayResponse(query: any, event: any): Promise<Response | null>;
    makeTopFrame(url: any, requestTS: any): Promise<Response>;
    makeHeadInsert(url: any, requestTS: any, date: any, topUrl: any, prefix: any, presetCookie: any, setCookie: any, isLive: any, referrer: any, extraOpts: any): string;
}
import { ArchiveResponse } from "./response.js";
//# sourceMappingURL=collection.d.ts.map