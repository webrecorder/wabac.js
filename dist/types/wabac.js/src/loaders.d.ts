export class CollectionLoader {
    colldb: import("idb/with-async-ittr").IDBPDatabase<unknown> | null;
    root: any;
    checkIpfs: boolean;
    _init_db: Promise<void>;
    _initDB(): Promise<void>;
    loadAll(dbColls: any): Promise<boolean>;
    listAll(): Promise<any[]>;
    loadColl(name: any): Promise<any>;
    reload(name: any): Promise<any>;
    deleteColl(name: any): Promise<boolean>;
    updateAuth(name: any, newHeaders: any): Promise<boolean>;
    updateMetadata(name: any, newMetadata: any): Promise<any>;
    updateSize(name: any, fullSize: any, dedupSize: any, decodeUpdate: any): Promise<any>;
    initNewColl(metadata: any, extraConfig?: {}, type?: string): Promise<any>;
    _initColl(data: any): Promise<any>;
    _initStore(type: any, config: any): Promise<ArchiveDB | RemoteSourceArchiveDB | RemotePrefixArchiveDB | MultiWACZ | RemoteWARCProxy | LiveProxy | null>;
    _createCollection(opts: any): any;
}
export class WorkerLoader extends CollectionLoader {
    constructor(worker: any);
    hasCollection(name: any): Promise<boolean>;
    registerListener(worker: any): void;
    _handleMessage(event: any): Promise<void>;
    doListAll(client: any): Promise<void>;
    addCollection(data: any, progressUpdate: any): Promise<false | {
        name: any;
        type: any;
        config: {
            root: any;
        };
    } | {
        config: any;
    } | undefined>;
}
import { ArchiveDB } from "./archivedb.js";
import { RemoteSourceArchiveDB } from "./remotearchivedb.js";
import { RemotePrefixArchiveDB } from "./remotearchivedb.js";
import { MultiWACZ } from "./wacz/multiwacz.js";
import { RemoteWARCProxy } from "./remotewarcproxy.js";
import { LiveProxy } from "./liveproxy.js";
//# sourceMappingURL=loaders.d.ts.map