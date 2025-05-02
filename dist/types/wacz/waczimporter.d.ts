import { type MultiWACZ } from "./multiwacz";
import { type WACZFile } from "./waczfile";
export declare const MAIN_PAGES_JSON = "pages/pages.jsonl";
export declare const EXTRA_PAGES_JSON = "pages/extraPages.jsonl";
export declare const DATAPACKAGE_JSON = "datapackage.json";
export declare const DATAPACKAGE_DIGEST_JSON = "datapackage-digest.json";
export declare class WACZImporter {
    store: MultiWACZ;
    file: WACZFile;
    isRoot: boolean;
    waczname: string;
    constructor(store: MultiWACZ, file: WACZFile, isRoot?: boolean);
    loadFileFromWACZ(filename: string, opts: Record<string, any>): Promise<import("./ziprangereader").ReaderAndHasher>;
    load(): Promise<any>;
    loadTextFileFromWACZ(filename: string, expectedHash?: string): Promise<string>;
    loadDigestData(filename: string): Promise<any>;
    loadPackage(filename: string, expectedDigest: string): Promise<any>;
    loadMultiWACZPackage(root: any): Promise<any>;
    loadLeafWACZPackage(datapackage: Record<string, any>): Promise<any>;
    loadOldPackageYAML(filename: string): Promise<Record<string, any>>;
    loadPages(filename?: string, expectedHash?: null): Promise<Record<string, any>[]>;
}
//# sourceMappingURL=waczimporter.d.ts.map