import { type RxRewriter, type Rule } from "./rxrewriter";
type Rules = {
    contains: string[];
    rxRules: Rule[];
};
export declare const DEFAULT_RULES: Rules[];
export declare const HTML_ONLY_RULES: Rules[];
export declare function hasRangeAsQuery(url: string): {
    start: string;
    end: string;
} | null;
export declare function removeRangeAsQuery(url: string): string | null;
export declare function ruleRewriteFBDash(text: string, opts: Record<string, any>): string;
type T = typeof RxRewriter;
export declare class DomainSpecificRuleSet {
    rwRules: Rules[];
    RewriterCls: T;
    rewriters: Map<any, any>;
    defaultRewriter: RxRewriter;
    constructor(RewriterCls: T, rwRules?: Rules[]);
    _initRules(): void;
    getCustomRewriter(url: string): any;
    getRewriter(url: string): any;
}
export {};
//# sourceMappingURL=dsruleset.d.ts.map