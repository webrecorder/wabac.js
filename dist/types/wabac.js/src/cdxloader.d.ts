import { WARCLoader } from "./warcloader.js";
import { CDXIndexer, WARCRecord, WARCParser } from "warcio";
export declare const CDX_COOKIE = "req.http:cookie";
type WARCRecordWithPage = WARCRecord & {
    _isPage: boolean;
};
declare class CDXFromWARCLoader extends WARCLoader {
    cdxindexer: CDXIndexer | null;
    sourceExtra: any;
    shaPrefix: string;
    constructor(reader: any, abort: any, id: any, sourceExtra?: {}, shaPrefix?: string);
    filterRecord(record: WARCRecordWithPage): "skip" | null;
    index(record: WARCRecord, parser: WARCParser): void;
    indexReqResponse(record: WARCRecordWithPage, reqRecord: WARCRecord, parser: WARCParser): void;
    getSource(cdx: any): any;
    addCdx(cdx: any): void;
}
declare class CDXLoader extends CDXFromWARCLoader {
    load(db: any, progressUpdate: any, totalSize: any): Promise<void>;
}
export { CDXLoader, CDXFromWARCLoader };
//# sourceMappingURL=cdxloader.d.ts.map