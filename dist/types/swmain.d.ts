import { Collection, type Prefixes } from "./collection";
import { WorkerLoader } from "./loaders";
import { StatsTracker } from "./statstracker";
import { API } from "./api";
import { type ExtraConfig, type CollMetadata } from "./types";
export declare class SWCollections extends WorkerLoader {
    prefixes: Prefixes;
    colls: Record<string, Collection>;
    inited: Promise<boolean> | null;
    root: string | null;
    defaultConfig: ExtraConfig;
    constructor(prefixes: Prefixes, root?: string | null, defaultConfig?: ExtraConfig);
    _createCollection(opts: Record<string, any>): Collection;
    loadAll(dbColl?: any): Promise<boolean>;
    getColl(name: string): Promise<Collection | undefined>;
    reload(name: string): Promise<void>;
    addCollection(data: any, progressUpdate: any): Promise<false | import("./loaders").LoadColl>;
    deleteColl(name: string, keepFileHandle?: boolean): Promise<boolean>;
    initNewColl(metadata: any, extraConfig?: {}, type?: string): Promise<any>;
    updateAuth(name: string, headers: Record<string, string>): Promise<boolean>;
    updateMetadata(name: string, newMetadata: CollMetadata): Promise<false | CollMetadata>;
    updateSize(name: string, fullSize: number, dedupSize: number, updateDecode?: boolean): Promise<false | CollMetadata>;
}
type SWReplayInitOpts = {
    staticData?: Map<string, any> | null;
    ApiClass?: typeof API;
    defaultConfig?: ExtraConfig;
    CollectionsClass?: typeof SWCollections;
};
export declare class SWReplay {
    prefix: string;
    replayPrefix: string;
    staticPrefix: string;
    distPrefix: string;
    proxyPrefix: string;
    staticData: Map<string, {
        type: string;
        content: string;
    }>;
    collections: SWCollections;
    proxyOriginMode: boolean;
    api: API;
    apiPrefix: string;
    allowRewrittenCache: boolean;
    topFramePassthrough: boolean;
    stats: StatsTracker | null;
    constructor({ staticData, ApiClass, defaultConfig, CollectionsClass, }?: SWReplayInitOpts);
    getIndexHtml(sp: URLSearchParams): string;
    isFromReplay(request: Request): boolean;
    handleFetch(event: FetchEvent): Promise<Response>;
    staticPathProxy(url: string, request: Request): Promise<Response>;
    wrapCSPForFrame(resp: Response, request: Request): Promise<Response>;
    defaultFetch(request: RequestInfo | URL, opts?: RequestInit): Promise<Response>;
    ensureCached(urls: string[]): Promise<void>;
    handleOffline(request: Request): Promise<Response>;
    getResponseFor(request: Request, event: FetchEvent): Promise<Response>;
}
export {};
//# sourceMappingURL=swmain.d.ts.map