import { DomainSpecificRuleSet } from "./dsruleset";
import { type ArchiveRequest } from "../request";
import { type ArchiveResponse } from "../response";
export { ArchiveResponse } from "../response";
export { rewriteDASH, rewriteHLS } from "./rewriteVideo";
export declare const jsRules: DomainSpecificRuleSet;
export declare const baseRules: DomainSpecificRuleSet;
export declare const htmlRules: DomainSpecificRuleSet;
type InsertFunc = (url: string) => string;
type RewriterOpts = {
    baseUrl: string;
    prefix: string;
    responseUrl?: string;
    workerInsertFunc?: InsertFunc | null;
    headInsertFunc?: InsertFunc | null;
    urlRewrite?: boolean;
    contentRewrite?: boolean;
    decode?: boolean;
    useBaseRules?: boolean;
};
export declare function getCustomRewriter(url: string, isHTML: boolean): any;
export declare class Rewriter {
    urlRewrite: boolean;
    contentRewrite: boolean;
    baseUrl: string;
    dsRules: DomainSpecificRuleSet;
    decode: boolean;
    prefix: string;
    relPrefix: string;
    schemeRelPrefix: string;
    scheme: string;
    url: string;
    responseUrl: string;
    isCharsetUTF8: boolean;
    headInsertFunc: InsertFunc | null;
    workerInsertFunc: InsertFunc | null;
    _jsonpCallback: string | boolean | null;
    constructor({ baseUrl, prefix, responseUrl, workerInsertFunc, headInsertFunc, urlRewrite, contentRewrite, decode, useBaseRules, }: RewriterOpts);
    getRewriteMode(request: ArchiveRequest, response: ArchiveResponse, url?: string, mime?: string): string;
    getScriptRewriteMode(mime: string, url: string, defaultType?: string): string;
    rewrite(response: ArchiveResponse, request: ArchiveRequest): Promise<ArchiveResponse>;
    updateBaseUrl(url: string): string;
    isRewritableUrl(url: string): boolean;
    rewriteUrl(url: string, forceAbs?: boolean): string;
    rewriteHtml(response: ArchiveResponse): Promise<ArchiveResponse>;
    rewriteCSS(text: string): string;
    rewriteJS(text: string, opts: Record<string, any>): any;
    rewriteJSON(text: string, opts: Record<string, any>): any;
    rewriteImportmap(text: string): string;
    parseJSONPCallback(url: string): boolean;
    rewriteJSONP(text: string): string;
    rewriteHeaders(headers: Headers, urlRewrite: boolean, contentRewrite: boolean, isAjax: boolean): Headers;
    rewriteLinkHeader(value: string): string;
}
//# sourceMappingURL=index.d.ts.map