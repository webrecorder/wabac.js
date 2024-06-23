export class SWReplay {
    constructor({ staticData, ApiClass, defaultConfig, CollectionsClass }?: {
        staticData?: null | undefined;
        ApiClass?: typeof API | undefined;
        defaultConfig?: {} | undefined;
        CollectionsClass?: typeof SWCollections | undefined;
    });
    prefix: any;
    replayPrefix: any;
    staticPrefix: string;
    distPrefix: string;
    staticData: Map<any, any>;
    collections: SWCollections;
    proxyOriginMode: boolean;
    api: API;
    apiPrefix: string;
    allowRewrittenCache: boolean;
    stats: StatsTracker | null;
    getIndexHtml(sp: any): string;
    handleFetch(event: any): Promise<any> | Response;
    staticPathProxy(url: any, request: any): Promise<Response>;
    defaultFetch(request: any): Promise<Response>;
    ensureCached(urls: any): Promise<void>;
    handleOffline(request: any): Promise<Response>;
    getResponseFor(request: any, event: any): Promise<any>;
}
export class SWCollections extends WorkerLoader {
    constructor(prefixes: any, root?: null, defaultConfig?: {});
    prefixes: any;
    colls: {};
    inited: Promise<boolean> | null;
    defaultConfig: {};
    _fileHandles: {};
    _createCollection(opts: any): Collection;
    getColl(name: any): Promise<any>;
    reload(name: any): Promise<void>;
    deleteColl(name: any, keepFileHandle?: boolean): Promise<boolean>;
    updateAuth(name: any, headers: any): Promise<void>;
}
import { API } from "./api.js";
import { StatsTracker } from "./statstracker.js";
import { WorkerLoader } from "./loaders.js";
import { Collection } from "./collection.js";
//# sourceMappingURL=swmain.d.ts.map