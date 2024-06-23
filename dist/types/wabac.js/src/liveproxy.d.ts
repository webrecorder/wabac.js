import { ArchiveResponse } from "./response.js";
export declare class LiveProxy {
    prefix: string;
    proxyPathOnly: boolean;
    isLive: boolean;
    archivePrefix: string;
    cloneResponse: boolean;
    allowBody: boolean;
    hostProxy: object | any[];
    hostProxyOnly: boolean;
    constructor(extraConfig: any, { cloneResponse, allowBody, hostProxyOnly }?: {
        cloneResponse?: boolean | undefined;
        allowBody?: boolean | undefined;
        hostProxyOnly?: boolean | undefined;
    });
    getAllPages(): Promise<never[]>;
    getFetchUrl(url: any, request: any, headers: any): any;
    getResource(request: any, prefix: any): Promise<ArchiveResponse | null>;
}
//# sourceMappingURL=liveproxy.d.ts.map