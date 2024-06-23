type FuzzyRule = {
    match: RegExp;
    fuzzyCanonReplace?: string;
    replace?: string;
    args?: any[][];
    split?: string;
    splitLast?: boolean;
    fuzzyArgs?: boolean;
    fuzzySet?: boolean;
    maxResults?: number;
};
type KeySet = {
    found: Set<string>;
    value: string[];
};
type KeySets = Record<string, KeySet>;
export declare class FuzzyMatcher {
    rules: FuzzyRule[];
    constructor(rules?: FuzzyRule[]);
    getRuleFor(reqUrl: any): {
        prefix: any;
        rule: any;
        fuzzyCanonUrl: any;
    };
    getFuzzyCanonsWithArgs(reqUrl: any): any[];
    fuzzyCompareUrls(reqUrl: any, results: any, matchedRule: any): any;
    fuzzyBestMatchQuery(reqUrl: any, results: any, rule: any): 0 | null;
    getMatch(reqQuery: any, foundQuery: any, reqArgs?: Set<string> | null, fuzzySet?: boolean): number;
    addSetMatch(keySets: any, key: string, value: string, foundValue: string): void;
    paramSetMatch(keySets: KeySets, weight: number): number;
    levScore(val1: string, val2: string): number;
}
export declare const fuzzyMatcher: FuzzyMatcher;
export {};
//# sourceMappingURL=fuzzymatcher.d.ts.map