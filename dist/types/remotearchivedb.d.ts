import { ArchiveDB, type ADBOpts } from "./archivedb";
import { BaseAsyncIterReader } from "warcio";
import { type BaseLoader } from "./blockloaders";
import { type Source, type ResourceEntry, type RemoteResourceEntry } from "./types";
import { type GetHash } from "./wacz/ziprangereader";
export type LoadRecordFromSourceType = Promise<{
    remote: ResourceEntry | null;
    hasher?: GetHash | null;
}>;
export type Opts = ADBOpts & {
    depth?: number;
};
export declare abstract class OnDemandPayloadArchiveDB extends ArchiveDB {
    noCache: boolean;
    streamMap: Map<string, ChunkStore>;
    constructor(name: string, noCache?: boolean);
    isSameUrl(remoteUrl: string, cdxUrl: string, method?: string | null): boolean;
    abstract loadRecordFromSource(cdx: RemoteResourceEntry): LoadRecordFromSourceType;
    loadPayload(cdx: ResourceEntry, opts: Opts): Promise<BaseAsyncIterReader | Uint8Array | null>;
    commitPayload(payload: Uint8Array | null | undefined, digest: string): Promise<void>;
}
export declare abstract class SimpleRemoteArchiveDB extends OnDemandPayloadArchiveDB {
    abstract loadSource(source: Source): Promise<ReadableStream<Uint8Array>>;
    loadRecordFromSource(cdx: RemoteResourceEntry): LoadRecordFromSourceType;
}
export declare class RemoteSourceArchiveDB extends SimpleRemoteArchiveDB {
    loader: BaseLoader;
    constructor(name: string, loader: BaseLoader, noCache?: boolean);
    updateHeaders(headers: Record<string, string>): void;
    loadSource(source: Source): Promise<ReadableStream<Uint8Array>>;
}
export declare class RemotePrefixArchiveDB extends SimpleRemoteArchiveDB {
    remoteUrlPrefix: string;
    headers: Record<string, string>;
    constructor(name: string, remoteUrlPrefix: string, headers: Record<string, string>, noCache?: boolean);
    updateHeaders(headers: Record<string, string>): void;
    loadSource(source: Source): Promise<ReadableStream<Uint8Array>>;
}
declare class ChunkStore {
    chunks: Uint8Array[];
    size: number;
    done: boolean;
    totalLength: number;
    nextChunk: Promise<boolean>;
    _nextResolve: (x: boolean) => void;
    constructor(totalLength: number);
    add(chunk: Uint8Array): void;
    concatChunks(): Uint8Array;
    getChunkIter(): AsyncGenerator<Uint8Array>;
}
export {};
//# sourceMappingURL=remotearchivedb.d.ts.map