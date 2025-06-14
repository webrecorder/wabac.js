type FuzzyRule = {
    match?: RegExp;
    fuzzyCanonReplace?: string;
    replace?: string;
    args?: any[][];
    split?: string;
    splitLast?: boolean;
    fuzzyArgs?: boolean;
    fuzzySet?: boolean;
    maxResults?: number;
};
type FuzzyResEntry = {
    url: string;
    status?: number | undefined;
    fuzzyMatchUrl?: string;
};
type KeySet = {
    found: Set<string>;
    value: string[];
};
type KeySets = Record<string, KeySet>;
export declare class FuzzyMatcher {
    rules: FuzzyRule[];
    constructor(rules?: FuzzyRule[]);
    getRuleFor(reqUrl: string): {
        prefix: string;
        rule: FuzzyRule | undefined;
        fuzzyCanonUrl: string;
    };
    getFuzzyCanonsWithArgs(reqUrl: string): string[];
    fuzzyCompareUrls(reqUrl: string, results: FuzzyResEntry[] | undefined, matchedRule?: FuzzyRule): FuzzyResEntry | null;
    fuzzyBestMatchQuery(reqUrlStr: string, results: FuzzyResEntry[], rule?: FuzzyRule): FuzzyResEntry | null;
    getMatch(reqQuery: URLSearchParams, foundQuery: URLSearchParams, reqArgs?: Set<string> | null, fuzzySet?: boolean): number;
    addSetMatch(keySets: KeySets, key: string, value: string, foundValue: string): void;
    paramSetMatch(keySets: KeySets, weight: number): number;
    levScore(val1: string, val2: string): number;
}
export declare const fuzzyMatcher: FuzzyMatcher;
export {};
//# sourceMappingURL=fuzzymatcher.d.ts.map