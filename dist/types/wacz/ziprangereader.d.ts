import { AsyncIterReader } from "warcio";
import { BaseLoader } from "../blockloaders";
import { type IHasher } from "hash-wasm/dist/lib/WASMInterface.js";
export type GetHash = {
    getHash: () => string;
};
export type ReaderAndHasher = {
    reader: AsyncIterReader;
    hasher?: GetHash | null;
};
export type LoadWACZEntry = Promise<ReaderAndHasher>;
export type ZipEntry = {
    filename: string;
    deflate: boolean;
    uncompressedSize: number;
    compressedSize: number;
    localEntryOffset: number;
    offset?: number;
};
export declare class HashingAsyncIterReader extends AsyncIterReader implements GetHash {
    hasher: IHasher | null;
    hashInited: boolean;
    hash: string;
    constructor(source: AsyncIterReader, compressed?: string, dechunk?: boolean);
    initHasher(): Promise<void>;
    _loadNext(): Promise<Uint8Array | null>;
    getHash(): string;
}
export declare class ZipRangeReader {
    loader: BaseLoader;
    entriesUpdated: boolean;
    enableHashing: boolean;
    entries: Record<string, ZipEntry> | null;
    constructor(loader: BaseLoader, entries?: Record<string, ZipEntry> | null);
    load(always?: boolean): Promise<Record<string, ZipEntry>>;
    _loadEntries(data: Uint8Array, dataStartOffset: number): Record<string, any> | null;
    getCompressedSize(name: string): number;
    loadFile(name: string, { offset, length, signal, unzip, computeHash, }?: {
        offset?: number;
        length?: number;
        signal?: AbortSignal | null;
        unzip?: boolean;
        computeHash?: boolean;
    }): Promise<ReaderAndHasher>;
    getUint64(dataview: DataView, byteOffset: number, littleEndian: boolean): number;
}
export declare class ZipBlockLoader extends BaseLoader {
    zipreader: ZipRangeReader;
    filename: string;
    constructor(zipreader: ZipRangeReader, filename: string);
    get isValid(): boolean;
    doInitialFetch(tryHead?: boolean): Promise<{
        response: Response;
        abort: null;
    }>;
    getLength(): Promise<number>;
    getRange(offset: number, length: number, streaming?: boolean, signal?: null): Promise<Uint8Array | ReadableStream<any>>;
}
//# sourceMappingURL=ziprangereader.d.ts.map