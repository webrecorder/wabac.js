import { AsyncIterReader, WARCParser, WARCRecord } from "warcio";
import { BaseParser, ResourceEntry } from "./baseparser.js";
declare class WARCLoader extends BaseParser {
    reader: AsyncIterReader;
    abort: AbortController | null;
    loadId: string | null;
    sourceExtra: object | null;
    anyPages: boolean;
    detectPages: boolean;
    _lastRecord: WARCRecord | null;
    metadata: any;
    pages: string[];
    lists: string[];
    pageMap: Record<string, any>;
    constructor(reader: any, abort?: null, loadId?: null, sourceExtra?: null);
    parseWarcInfo(record: WARCRecord): void;
    index(record: WARCRecord, parser: WARCParser): void;
    indexDone(parser: WARCParser): void;
    shouldIndexMetadataRecord(record: WARCRecord): boolean;
    parseRevisitRecord(record: WARCRecord, reqRecord: WARCRecord | null): ResourceEntry | null;
    parseResponseHttpHeaders(record: WARCRecord, url: string, reqRecord: WARCRecord | null): {
        status: number;
        method: string | null | undefined;
        headers: Headers;
        mime: string;
    } | null;
    indexReqResponse(record: WARCRecord, reqRecord: WARCRecord | null, parser: WARCParser): void;
    parseRecords(record: WARCRecord, reqRecord: WARCRecord | null): ResourceEntry | null;
    isFullRangeRequest(headers: any): any;
    filterRecord(record: WARCRecord): string | null;
    load(db: any, progressUpdate: any, totalSize: any): Promise<any>;
    _finishLoad(): Promise<void>;
}
declare function isPage(url: any, status: any, mime: any): boolean;
declare class SingleRecordWARCLoader extends WARCLoader {
    constructor(reader: any);
    addPage(): void;
    load(): Promise<ResourceEntry | null>;
}
declare class WARCInfoOnlyWARCLoader extends WARCLoader {
    filterRecord(record: WARCRecord): "done" | null;
}
export { WARCLoader, SingleRecordWARCLoader, isPage, WARCInfoOnlyWARCLoader };
//# sourceMappingURL=warcloader.d.ts.map