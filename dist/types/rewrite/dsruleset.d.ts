import { RxRewriter, type Rule } from "./rxrewriter";
type Rules = {
    contains: string[];
    rxRules: Rule[];
};
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