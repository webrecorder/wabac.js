declare class BaseParser {
    batchSize: number;
    promises: Promise<void>[];
    batch: string[];
    count: number;
    dupeSet: Set<string>;
    db: any;
    constructor(batchSize?: number);
    addPage(page: any): void;
    isBatchFull(): boolean;
    addResource(res: any): void;
    flush(): void;
    finishIndexing(): Promise<void>;
    _finishLoad(): void;
}
export { BaseParser };
//# sourceMappingURL=baseparser.d.ts.map