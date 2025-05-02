import { type Source, WARCParser, type WARCRecord } from "warcio";
import { BaseParser } from "./baseparser";
import { type CollMetadata, type ResourceEntry } from "./types";
declare class WARCLoader extends BaseParser {
    reader: Source;
    abort: AbortController | null;
    loadId: string | null;
    sourceExtra: object | null;
    anyPages: boolean;
    detectPages: boolean;
    _lastRecord: WARCRecord | null;
    metadata: CollMetadata;
    pages: string[];
    lists: string[];
    pageMap: Record<string, any>;
    constructor(reader: Source, abort?: AbortController | null, loadId?: string | null, sourceExtra?: null);
    parseWarcInfo(record: WARCRecord): void;
    index(record: WARCRecord, parser: WARCParser): void;
    indexDone(parser: WARCParser): void;
    shouldIndexMetadataRecord(record: WARCRecord): boolean;
    parseRevisitRecord(record: WARCRecord, reqRecord: WARCRecord | null): ResourceEntry | null;
    parseResponseHttpHeaders(record: WARCRecord, url: string, reqRecord: WARCRecord | null): {
        status: number;
        method: string | undefined;
        headers: Headers;
        mime: string;
    } | null;
    indexReqResponse(record: WARCRecord, reqRecord: WARCRecord | null, parser: WARCParser): void;
    parseRecords(record: WARCRecord, reqRecord: WARCRecord | null): ResourceEntry | null;
    isFullRangeRequest(headers: Headers | Map<string, string>): boolean | "" | null | undefined;
    filterRecord(record: WARCRecord): string | null;
    load(db: any, progressUpdate: any, totalSize?: number): Promise<CollMetadata>;
    _finishLoad(): Promise<void>;
}
declare function isPage(url: string, status: number, mime: string): boolean;
declare class SingleRecordWARCLoader extends WARCLoader {
    constructor(reader: Source);
    addPage(): void;
    load(): Promise<ResourceEntry | null>;
}
declare class WARCInfoOnlyWARCLoader extends WARCLoader {
    filterRecord(record: WARCRecord): "done" | null;
}
export { WARCLoader, SingleRecordWARCLoader, isPage, WARCInfoOnlyWARCLoader };
//# sourceMappingURL=warcloader.d.ts.map