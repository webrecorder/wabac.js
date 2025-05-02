import { type CollMetadata, type ArchiveLoader, type DBStore, type PageEntry } from "./types";
export type ResourceEntry = {
    url: string;
    ts: number;
    digest?: string | null;
    status?: number;
    mime?: string;
    respHeaders?: Record<string, string> | null;
    reqHeaders?: Record<string, string> | null;
    recordDigest?: string | null;
    payload?: Uint8Array | null;
    reader?: AsyncIterable<Uint8Array> | Iterable<Uint8Array> | null;
    referrer?: string | null;
    extraOpts?: Record<string, any> | null;
    pageId?: string | null;
    origURL?: string | null;
    origTS?: number | null;
    source?: object;
    requestUrl?: string | null;
    method?: string | null;
    requestBody?: Uint8Array;
    loaded?: boolean;
};
declare abstract class BaseParser implements ArchiveLoader {
    batchSize: number;
    promises: Promise<void>[];
    batch: ResourceEntry[];
    count: number;
    dupeSet: Set<string>;
    db: any;
    constructor(batchSize?: number);
    addPage(page: PageEntry): void;
    isBatchFull(): boolean;
    addResource(res: ResourceEntry): void;
    flush(): void;
    finishIndexing(): Promise<void>;
    _finishLoad(): void;
    abstract load(db: DBStore, progressUpdateCallback?: any, totalLength?: number): Promise<CollMetadata | undefined>;
}
export { BaseParser };
//# sourceMappingURL=baseparser.d.ts.map