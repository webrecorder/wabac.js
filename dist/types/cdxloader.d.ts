import { WARCLoader } from "./warcloader";
import { CDXIndexer, type WARCRecord, type WARCParser, type Source } from "warcio";
export declare const CDX_COOKIE = "req.http:cookie";
type WARCRecordWithPage = WARCRecord & {
    _isPage: boolean;
};
declare class CDXFromWARCLoader extends WARCLoader {
    cdxindexer: CDXIndexer | null;
    sourceExtra: any;
    shaPrefix: string;
    constructor(reader: Source, abort: AbortController | null, id: string, sourceExtra?: {}, shaPrefix?: string);
    filterRecord(record: WARCRecordWithPage): "skip" | null;
    index(record: WARCRecord, parser: WARCParser): void;
    indexReqResponse(record: WARCRecordWithPage, reqRecord: WARCRecord, parser: WARCParser): void;
    getSource(cdx: Record<string, any>): any;
    addCdx(cdx: Record<string, any>): void;
}
declare class CDXLoader extends CDXFromWARCLoader {
    load(db: any, progressUpdate?: any, totalSize?: number): Promise<{}>;
}
export { CDXLoader, CDXFromWARCLoader };
//# sourceMappingURL=cdxloader.d.ts.map