import { ArchiveRequest } from "./request";
export declare const MAX_FULL_DOWNLOAD_SIZE = 25000000;
export declare const PAGE_STATE_NOT_FINISHED = 0;
export declare const PAGE_STATE_NEED_REMOTE_SYNC = 16;
export declare const PAGE_STATE_NEED_LOCAL_SYNC = 1;
export declare const PAGE_STATE_SYNCED = 17;
export declare const MAX_STREAM_CHUNK_SIZE: number;
export declare const REPLAY_TOP_FRAME_NAME = "___wb_replay_top_frame";
export declare const REMOVE_EXPIRES: RegExp;
export declare function startsWithAny(value: string, iter: Iterable<string>): boolean;
export declare function containsAny(value: string, iter: Iterable<string>): boolean;
export declare function getTS(iso: string): string;
export declare function getTSMillis(iso: string): string;
export declare function tsToDate(ts: string): Date;
export declare function tsToSec(ts: string): number;
export declare function getSecondsStr(date: Date): string;
export declare function base16(hashBuffer: ArrayBuffer): string;
export declare function digestMessage(message: string | Uint8Array, hashtype: string, prefix?: string | null): Promise<string>;
export declare function decodeLatin1(buf: Uint8Array): string;
export declare function encodeLatin1(str: string): Uint8Array;
export declare function randomId(): string;
export declare function makeHeaders(headers: Record<string, string>): Headers;
export declare function parseSetCookie(setCookie: string, scheme: string): string;
export declare function isNullBodyStatus(status: number): boolean;
export declare function getStatusText(status: number): string;
export declare function isAjaxRequest(request: ArchiveRequest): boolean;
export declare function handleAuthNeeded(e: Error, config: any): Promise<boolean>;
export declare function notFound(request: Request, msg: string, status?: number): Response;
export declare function getCollData(coll: any): any;
export declare class RangeError {
    info: Record<string, any>;
    constructor(info?: {});
    toString(): string;
}
export declare class AuthNeededError extends RangeError {
}
export declare class AccessDeniedError extends RangeError {
}
export declare class Canceled {
}
export declare function sleep(millis: number): Promise<unknown>;
//# sourceMappingURL=utils.d.ts.map