export type Rule = [
    RegExp,
    (x: string, opts: Record<string, any>, offset: number, str: string) => string
];
export declare class RxRewriter {
    rules: Rule[] | null;
    rx: RegExp | null;
    constructor(rules?: Rule[]);
    compileRules(): void;
    doReplace(match: string, params: any[], opts: Record<string, any>): string;
    rewrite(text: string, opts: Record<string, any>): string;
}
//# sourceMappingURL=rxrewriter.d.ts.map