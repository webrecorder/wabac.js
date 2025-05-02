import { ArchiveResponse } from "./response";
import { type DBStore } from "./types";
import { type ArchiveRequest } from "./request";
export declare class RemoteWARCProxy implements DBStore {
    sourceUrl: string;
    type: string;
    notFoundPageUrl: string;
    constructor(rootConfig: Record<string, any>);
    getAllPages(): Promise<never[]>;
    getResource(request: ArchiveRequest, prefix: string): Promise<ArchiveResponse | Response | null>;
    resolveHeaders(url: string): Promise<{
        encodedUrl: string;
        headers: Headers | null;
        date: Date | null;
        status: number;
        statusText: string;
        hasPayload: boolean;
    } | null>;
}
//# sourceMappingURL=remotewarcproxy.d.ts.map