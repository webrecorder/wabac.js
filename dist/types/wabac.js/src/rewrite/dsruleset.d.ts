import { RxRewriter, type Rule } from "./rxrewriter";
type Rules = {
    contains: string[];
    rxRules: Rule[];
};
export declare const DEFAULT_RULES: Rules[];
export declare const HTML_ONLY_RULES: Rules[];
type T = typeof RxRewriter;
export declare class DomainSpecificRuleSet {
    rwRules: Rules[];
    RewriterCls: T;
    rewriters: Map<any, any>;
    defaultRewriter: RxRewriter;
    constructor(RewriterCls: T, rwRules?: Rules[]);
    _initRules(): void;
    getRewriter(url: string): any;
}
export {};
//# sourceMappingURL=dsruleset.d.ts.map