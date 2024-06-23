export class OnDemandPayloadArchiveDB extends ArchiveDB {
    constructor(name: any, noCache?: boolean);
    noCache: boolean;
    streamMap: Map<any, any>;
    loadRecordFromSource(cdx: any): Promise<{
        remote: import("./baseparser.js").ResourceEntry | null;
    }>;
    loadPayload(cdx: any, opts: any): Promise<any>;
    commitPayload(payload: any, digest: any): Promise<void>;
}
export class RemotePrefixArchiveDB extends OnDemandPayloadArchiveDB {
    constructor(name: any, remoteUrlPrefix: any, headers: any, noCache?: boolean);
    remoteUrlPrefix: any;
    headers: any;
    updateHeaders(headers: any): void;
    loadSource(source: any): Promise<Uint8Array | ReadableStream<any>>;
}
export class RemoteSourceArchiveDB extends OnDemandPayloadArchiveDB {
    constructor(name: any, loader: any, noCache?: boolean);
    loader: any;
    updateHeaders(headers: any): void;
    loadSource(source: any): Promise<any>;
}
import { ArchiveDB } from "./archivedb.js";
//# sourceMappingURL=remotearchivedb.d.ts.map