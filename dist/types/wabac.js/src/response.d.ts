import { AsyncIterReader } from "warcio";
type ArchiveResponseOpts = {
    payload: AsyncIterReader | Uint8Array | null;
    status: number;
    statusText: string;
    headers: Headers;
    url: string;
    date: Date | null;
    extraOpts?: Record<string, any> | null;
    noRW: boolean;
    isLive: boolean;
    updateTS: string | null;
};
declare class ArchiveResponse {
    static fromResponse({ url, response, date, noRW, isLive, archivePrefix }: {
        url: string;
        response: Response;
        date: Date;
        noRW: boolean;
        isLive: boolean;
        archivePrefix: string;
    }): ArchiveResponse;
    reader: AsyncIterReader | null;
    buffer: Uint8Array | null;
    status: number;
    statusText: string;
    url: string;
    date: Date | null;
    extraOpts: Record<string, any> | null;
    headers: Headers;
    noRW: boolean;
    isLive: boolean;
    updateTS: string | null;
    clonedResponse: Response | null;
    constructor({ payload, status, statusText, headers, url, date, extraOpts, noRW, isLive, updateTS }: ArchiveResponseOpts);
    getText(isUTF8?: boolean): Promise<string>;
    setText(text: string, encodeUTF8?: boolean): void;
    getBuffer(): Promise<Uint8Array | null>;
    setBuffer(buffer: Uint8Array): void;
    setReader(reader: AsyncIterReader | ReadableStream): void;
    expectedLength(): number;
    createIter(): AsyncGenerator<Uint8Array, void, unknown>;
    [Symbol.asyncIterator](): AsyncGenerator<Uint8Array, void, unknown>;
    setRange(range: string): boolean;
    makeResponse(coHeaders?: boolean, overwriteDisposition?: boolean): Response;
}
export { ArchiveResponse };
//# sourceMappingURL=response.d.ts.map