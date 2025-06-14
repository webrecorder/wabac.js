import { MultiWACZ } from "./wacz/multiwacz";
import { type IDBPDatabase } from "idb/with-async-ittr";
import { type CollConfig, type DBStore, type CollMetadata } from "./types";
export type LoadColl = {
    name: string;
    type: string;
    config: CollConfig;
    store?: DBStore;
};
export type CollDB = {
    colls: {
        key: string;
        value: {
            name: string;
            type: string;
            config: CollConfig;
        };
        indexes: {
            type: string;
        };
    };
    settings: {
        key: string;
        value: number;
    };
};
export declare class CollectionLoader {
    root: string | null;
    colldb: IDBPDatabase<CollDB> | null;
    checkIpfs: boolean;
    _init_db: Promise<void>;
    _fileHandles: Record<string, FileSystemFileHandle> | null;
    constructor();
    _initDB(): Promise<void>;
    loadAll(dbColls: string): Promise<boolean>;
    listAll(): Promise<{
        name: string;
        type: string;
        config: CollConfig;
    }[]>;
    loadColl(name: string): Promise<any>;
    reload(name: string): Promise<any>;
    deleteColl(name: string): Promise<boolean>;
    deleteExpireMultiWACZs(stores: MultiWACZ[]): Promise<void>;
    updateAuth(name: string, newHeaders: Record<string, string>): Promise<boolean>;
    updateMetadata(name: string, newMetadata: CollMetadata): Promise<false | CollMetadata>;
    updateSize(name: string, fullSize: number, dedupSize: number, decodeUpdate?: boolean): Promise<CollMetadata | false>;
    initNewColl(metadata: CollMetadata, extraConfig?: {}, type?: string): Promise<any>;
    private _initColl;
    _initStore(type: string, config: CollConfig): Promise<DBStore | null>;
    _createCollection(opts: Record<string, any>): Record<string, any>;
}
export declare class WorkerLoader extends CollectionLoader {
    constructor(worker: WorkerGlobalScope);
    hasCollection(name: string): Promise<boolean>;
    registerListener(worker: WorkerGlobalScope): void;
    _handleMessage(event: MessageEvent): Promise<void>;
    doListAll(client: (WorkerGlobalScope & typeof globalThis) | MessageEventSource): Promise<void>;
    addCollection(data: Record<string, any>, progressUpdate: any): Promise<LoadColl | false>;
}
//# sourceMappingURL=loaders.d.ts.map