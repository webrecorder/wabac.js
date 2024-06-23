export const MAIN_PAGES_JSON: "pages/pages.jsonl";
export const EXTRA_PAGES_JSON: "pages/extraPages.jsonl";
export const DATAPACKAGE_JSON: "datapackage.json";
export const DATAPACKAGE_DIGEST_JSON: "datapackage-digest.json";
export class WACZImporter {
    constructor(store: any, file: any, isRoot?: boolean);
    file: any;
    waczname: any;
    store: any;
    isRoot: boolean;
    loadFileFromWACZ(filename: any, opts: any): Promise<any>;
    load(): Promise<any>;
    loadTextFileFromWACZ(filename: any, expectedHash?: boolean): Promise<string>;
    loadDigestData(filename: any): Promise<any>;
    loadPackage(filename: any, expectedDigest: any): Promise<any>;
    loadMultiWACZPackage(root: any): Promise<any>;
    loadLeafWACZPackage(datapackage: any): Promise<any>;
    loadOldPackageYAML(filename: any): Promise<{
        desc: any;
        title: any;
    }>;
    loadPages(filename?: string, expectedHash?: null): Promise<any>;
}
//# sourceMappingURL=waczimporter.d.ts.map