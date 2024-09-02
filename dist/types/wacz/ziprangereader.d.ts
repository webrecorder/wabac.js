import { AsyncIterReader } from "warcio";
import { BaseLoader } from "../blockloaders.js";
import { IHasher } from "hash-wasm/dist/lib/WASMInterface.js";
import { GetHash } from "../remotearchivedb.js";
export type ReaderAndHasher = {
    reader: AsyncIterReader | null;
    hasher?: GetHash | null;
};
export type LoadWACZEntry = Promise<ReaderAndHasher>;
export declare class HashingAsyncIterReader extends AsyncIterReader implements GetHash {
    hasher: IHasher | null;
    hashInited: boolean;
    hash: string;
    constructor(source: any, compressed?: string, dechunk?: boolean);
    initHasher(): Promise<void>;
    _loadNext(): Promise<Uint8Array | null>;
    getHash(): string;
}
export declare class ZipRangeReader {
    loader: BaseLoader;
    entriesUpdated: boolean;
    enableHashing: boolean;
    entries: Record<string, any> | null;
    constructor(loader: any, entries?: Record<string, any> | null);
    load(always?: boolean): Promise<Record<string, any> | null>;
    _loadEntries(data: any, dataStartOffset: any): Record<string, any> | null;
    getCompressedSize(name: any): number;
    loadFile(name: any, { offset, length, signal, unzip, computeHash }: {
        offset?: number;
        length?: number;
        signal?: AbortSignal | null;
        unzip?: boolean;
        computeHash?: boolean;
    }): Promise<ReaderAndHasher>;
    getUint64(dataview: any, byteOffset: any, littleEndian: any): any;
}
export declare class ZipBlockLoader extends BaseLoader {
    zipreader: ZipRangeReader;
    filename: string;
    size: number;
    constructor(zipreader: any, filename: any);
    get isValid(): boolean;
    doInitialFetch(tryHead?: boolean): Promise<{
        response: Response;
        abort: null;
    }>;
    getLength(): Promise<number>;
    getRange(offset: any, length: any, streaming?: boolean, signal?: null): Promise<Uint8Array | ReadableStream<any>>;
}
//# sourceMappingURL=ziprangereader.d.ts.map