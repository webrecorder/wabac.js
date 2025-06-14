import { type Rule, RxRewriter } from "./rxrewriter";
declare class JSRewriter extends RxRewriter {
    extraRules: Rule[];
    firstBuff: string;
    lastBuff: string;
    constructor(extraRules: Rule[]);
    initLocalDecl(localDecls: string[]): string;
    getModuleDecl(localDecls: string[], prefix: string): string;
    detectIsModule(text: string): boolean;
    parseGlobals(text: string): string;
    rewrite(text: string, opts: Record<string, any>): string;
    getESMImportRule(): Rule;
}
export { JSRewriter };
//# sourceMappingURL=jsrewriter.d.ts.map