import { type ArchiveResponse, type Rewriter } from "./index.js";
import { type StartTag } from "parse5-sax-parser";
import { type Token } from "parse5";
type TextNodeRewriteRule = {
    urlMatch: RegExp;
    match: RegExp;
    replace: string;
};
export declare class HTMLRewriter {
    rewriter: Rewriter;
    rule: TextNodeRewriteRule | null;
    ruleMatch: RegExpMatchArray | null;
    isCharsetUTF8: boolean;
    constructor(rewriter: Rewriter, isCharsetUTF8?: boolean);
    rewriteMetaContent(attrs: Token.Attribute[], attr: Token.Attribute, rewriter: Rewriter): string;
    rewriteSrcSet(value: string, rewriter: Rewriter): string;
    rewriteTagAndAttrs(tag: StartTag, attrRules: Record<string, string>, rewriter: Rewriter): void;
    getAttr(attrs: Token.Attribute[], name: string): string | null;
    getScriptRWType(tag: StartTag): "" | "json" | "js" | "module" | "text" | "importmap";
    rewrite(response: ArchiveResponse): Promise<ArchiveResponse>;
    rewriteUrl(rewriter: Rewriter, text: string, forceAbs?: boolean, mod?: string): string;
    rewriteHTMLText(text: string): string;
    rewriteJSBase64(text: string, rewriter: Rewriter): string;
}
export declare class ProxyHTMLRewriter extends HTMLRewriter {
    rewriteUrl(rewriter: Rewriter, text: string, forceAbs?: boolean, mod?: string): string;
    rewriteTagAndAttrs(tag: StartTag, attrRules: Record<string, string>, rewriter: Rewriter): void;
}
export {};
//# sourceMappingURL=html.d.ts.map