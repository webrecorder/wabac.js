export class SingleWACZLoader {
    constructor(loader: any, config: any, loadId?: null);
    loader: any;
    loadId: any;
    loadUrl: any;
    load(db: any): Promise<any>;
}
export class SingleWACZFullImportLoader {
    constructor(loader: any, config: any, loadId?: null);
    config: any;
    loadId: any;
    loader: any;
    load(db: any, progressUpdateCallback?: null, fullTotalSize?: number): Promise<any>;
    loadWARC(db: any, zipreader: any, filename: any, progressUpdate: any, total: any): Promise<any>;
}
export class JSONResponseMultiWACZLoader {
    constructor(response: any);
    response: any;
    load(db: any): Promise<any>;
}
//# sourceMappingURL=waczloader.d.ts.map