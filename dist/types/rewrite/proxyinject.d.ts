type WbInfo = {
    prefix: string;
    proxyOrigin: string;
    localOrigin: string;
    proxyTLD?: string;
    localTLD?: string;
    presetCookie?: string;
    seconds: string;
};
declare class ProxyWombatRewrite {
    proxyOrigin: string;
    localOrigin: string;
    proxyTLD?: string;
    localTLD?: string;
    localScheme: string;
    proxyScheme: string;
    httpToHttpsNeeded: boolean;
    prefix: string;
    relPrefix: string;
    schemeRelPrefix: string;
    constructor();
    initPresetCookie(presetCookie: string): void;
    recurseRewriteElem(curr: Element): void;
    rewriteElem(curr: Element): void;
    domOverride(): void;
    openOverride(): void;
    overrideInsertAdjacentHTML(): void;
    rewriteRxHtml(text: string): string;
    convUrl(urlStr: string, fromOrigin: string, toOrigin: string, fromTLD?: string, toTLD?: string, fromSep?: string, toSep?: string, toScheme?: string, httpToHttpsNeeded?: boolean): string;
    rewriteUrl(urlStr: string): string;
    unrewriteUrl(urlStr: string): string;
    fullRewriteUrl(url: string, mod?: string): string;
    isRewritableUrl(url: string): boolean;
    initAnchorElemOverride(): void;
    initDateOverride(timestamp: string): void;
}
//# sourceMappingURL=proxyinject.d.ts.map