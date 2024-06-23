import { BaseParser } from "./baseparser.js";
declare class HARLoader extends BaseParser {
    har: string | any;
    pageRefs: Record<string, string>;
    constructor(string_or_har: any);
    load(db: any): Promise<{}>;
    parsePages(har: any): void;
    parseEntries(har: any): void;
}
export { HARLoader };
//# sourceMappingURL=harloader.d.ts.map