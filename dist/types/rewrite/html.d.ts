import { Rewriter } from "./index.js";
type TextNodeRewriteRule = {
    urlMatch: RegExp;
    match: RegExp;
    replace: string;
};
declare class HTMLRewriter {
    rewriter: Rewriter;
    rule: TextNodeRewriteRule | null;
    ruleMatch: RegExpMatchArray | null;
    isCharsetUTF8: boolean;
    constructor(rewriter: any, isCharsetUTF8?: boolean);
    rewriteMetaContent(attrs: any, attr: any, rewriter: any): any;
    rewriteSrcSet(value: any, rewriter: any): string;
    rewriteTagAndAttrs(tag: any, attrRules: any, rewriter: any): void;
    getAttr(attrs: any, name: any): any;
    getScriptRWType(tag: any): "" | "json" | "text" | "module" | "js" | "importmap";
    rewrite(response: any): Promise<any>;
    rewriteUrl(rewriter: any, text: any, forceAbs?: boolean, mod?: string): any;
    rewriteHTMLText(text: any): any;
    rewriteJSBase64(text: any, rewriter: any): any;
}
export { HTMLRewriter };
//# sourceMappingURL=html.d.ts.map