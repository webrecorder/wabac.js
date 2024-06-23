export class RemoteWARCProxy {
    constructor(rootConfig: any);
    sourceUrl: any;
    type: any;
    notFoundPageUrl: any;
    getAllPages(): Promise<never[]>;
    getResource(request: any, prefix: any): Promise<ArchiveResponse | Response | null | undefined>;
    resolveHeaders(url: any): any;
}
import { ArchiveResponse } from "./response.js";
//# sourceMappingURL=remotewarcproxy.d.ts.map