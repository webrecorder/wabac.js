import { type ArchiveResponse } from "../response";
declare function decodeResponse(response: ArchiveResponse, contentEncoding: string | null, transferEncoding: string | null, noRW: boolean): Promise<ArchiveResponse>;
declare function decodeContent(content: Uint8Array, contentEncoding: string | null, transferEncoding: string | null): Promise<Uint8Array>;
export { decodeResponse, decodeContent };
//# sourceMappingURL=decoder.d.ts.map