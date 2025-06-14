import { BaseParser } from "./baseparser";
import { type CollMetadata } from "./types";
type HAR = Record<string, any>;
declare class HARLoader extends BaseParser {
    har: HAR;
    pageRefs: Record<string, string>;
    constructor(string_or_har: string | HAR);
    load(db: any): Promise<CollMetadata | undefined>;
    parsePages(har: HAR): void;
    parseEntries(har: HAR): void;
}
export { HARLoader };
//# sourceMappingURL=harloader.d.ts.map