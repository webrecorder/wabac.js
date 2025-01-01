declare let self: ServiceWorkerGlobalScope;

import { getReasonPhrase } from "http-status-codes";
import { type ArchiveRequest } from "./request";

// Threshold size for switching to range requests
export const MAX_FULL_DOWNLOAD_SIZE = 25000000;

export const PAGE_STATE_NOT_FINISHED = 0x00;
export const PAGE_STATE_NEED_REMOTE_SYNC = 0x10;
export const PAGE_STATE_NEED_LOCAL_SYNC = 0x01;
export const PAGE_STATE_SYNCED = 0x11;

export const INITIAL_STREAM_CHUNK_SIZE = 512;
export const MAX_STREAM_CHUNK_SIZE = 65536 * 4;

export const REPLAY_TOP_FRAME_NAME = "___wb_replay_top_frame";

export const REMOVE_EXPIRES = /Expires=\w{3},\s\d[^;,]+(?:;\s*)?/gi;

export function startsWithAny(value: string, iter: Iterable<string>) {
  for (const str of iter) {
    if (value.startsWith(str)) {
      return true;
    }
  }

  return false;
}

export function containsAny(value: string, iter: Iterable<string>) {
  for (const str of iter) {
    if (value.indexOf(str) >= 0) {
      return true;
    }
  }

  return false;
}

export function getTS(iso: string) {
  return iso.replace(/[-:T]/g, "").slice(0, 14);
}

export function getTSMillis(iso: string) {
  return iso.replace(/[-:.TZ]/g, "");
}

export function tsToDate(ts: string) {
  if (!ts) {
    return new Date();
  }

  if (ts.length < 17) {
    ts += "00000101000000000".substring(ts.length);
  }

  const datestr =
    ts.substring(0, 4) +
    "-" +
    ts.substring(4, 6) +
    "-" +
    ts.substring(6, 8) +
    "T" +
    ts.substring(8, 10) +
    ":" +
    ts.substring(10, 12) +
    ":" +
    ts.substring(12, 14) +
    "." +
    ts.substring(14) +
    "Z";

  return new Date(datestr);
}

export function tsToSec(ts: string) {
  return tsToDate(ts).getTime() / 1000;
}

export function getSecondsStr(date: Date) {
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!date) {
    return "";
  }

  try {
    return "" + date.getTime() / 1000;
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    return "";
  }
}

export function base16(hashBuffer: ArrayBuffer) {
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function digestMessage(
  message: string | Uint8Array,
  hashtype: string,
  prefix: string | null = null,
) {
  const msgUint8 =
    typeof message === "string" ? new TextEncoder().encode(message) : message;
  const hashBuffer = await crypto.subtle.digest(hashtype, msgUint8);
  if (prefix === "") {
    return base16(hashBuffer);
  }
  return (prefix || hashtype) + ":" + base16(hashBuffer);
}

export function decodeLatin1(buf: Uint8Array) {
  let str = "";
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let i = 0; i < buf.length; i++) {
    // @ts-expect-error [TODO] - TS2345 - Argument of type 'number | undefined' is not assignable to parameter of type 'number'.
    str += String.fromCharCode(buf[i]);
  }
  return str;
}

export function encodeLatin1(str: string) {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    buf[i] = str.charCodeAt(i) & 0xff;
  }
  return buf;
}

//from http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
export function randomId() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

export function makeHeaders(
  headers: Headers | Record<string, string> | Map<string, string>,
) {
  try {
    return new Headers(headers as Headers);
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // try to sanitize the headers, if any errors
    if (typeof headers === "object") {
      const headersObj = headers as Record<string, string>;
      for (const key of Object.keys(headers)) {
        const value = headersObj[key];
        // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
        const newValue = value.replace(/[\r\n]+/g, ", ");
        if (value != newValue) {
          headersObj[key] = newValue;
        }
      }
    } else {
      const headersMap = headers as Map<string, string>;
      for (const key of Object.keys(headers)) {
        const value = headersMap.get(key) || "";
        const newValue = value.replace(/[\r\n]+/g, ", ");
        if (value != newValue) {
          headersMap.set(key, newValue);
        }
      }
    }
    return new Headers(headers as Headers);
  }
}

export function parseSetCookie(setCookie: string, scheme: string) {
  setCookie = setCookie.replace(REMOVE_EXPIRES, "");
  const cookies: string[] = [];

  for (const cookie of setCookie.split(",")) {
    const cookieCore = cookie.split(";", 1)[0];
    // if has cookie flags
    if (cookieCore !== cookie) {
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      const cookieRemainder = cookie.slice(cookieCore.length).toLowerCase();
      if (cookieRemainder.indexOf("httponly") > 0) {
        continue;
      }
      if (scheme === "http" && cookieRemainder.indexOf("secure") > 0) {
        continue;
      }
    }

    // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
    cookies.push(cookieCore);
  }

  return cookies.join(";");
}

const NULL_STATUS = [101, 204, 205, 304];

export function isNullBodyStatus(status: number) {
  return NULL_STATUS.includes(status);
}

export function getStatusText(status: number) {
  try {
    return getReasonPhrase(status);
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    return "Unknown Status";
  }
}

export function isAjaxRequest(request: ArchiveRequest | Request) {
  if (request.headers.get("X-Pywb-Requested-With") === "XMLHttpRequest") {
    return true;
  }

  if (request.mode === "cors") {
    // if 'mod' is esm_, then likely a module import
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (request.destination === "script" && (request as any).mod === "esm_") {
      return false;
    }
    return true;
  }

  return false;
}

// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleAuthNeeded(e: any, config: any) {
  if (e instanceof AuthNeededError) {
    //const client = await self.clients.get(event.clientId || event.resultingClientId);
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      const url = new URL(client.url);
      if (url.searchParams.get("source") === config.sourceUrl) {
        client.postMessage({
          source: config.sourceUrl,
          coll: config.dbname.slice(3),
          type: "authneeded",
          // @ts-expect-error [TODO] - TS4111 - Property 'fileHandle' comes from an index signature, so it must be accessed with ['fileHandle'].
          fileHandle: e.info.fileHandle,
        });
      }
    }
    return true;
  }

  return false;
}

export function notFound(request: Request, msg?: string, status = 404) {
  let content;
  let contentType;

  if (!msg) {
    msg = "Sorry, this url was not found in the archive.";
  }

  if (
    request.destination === "script" ||
    request.headers.get("x-pywb-requested-with")
  ) {
    content = JSON.stringify(msg);
    contentType = "application/json";
  } else {
    content = msg;
    contentType = "text/html";
  }

  //console.log(`Not Found ${request.destination} - ${msg}`);

  const initOpt = {
    status: status,
    statusText: getStatusText(status),
    headers: { "Content-Type": contentType },
  };

  return new Response(content, initOpt);
}

// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCollData(coll: any) {
  const metadata = coll.config.metadata ? coll.config.metadata : {};

  const res = {
    ...metadata,
    title: metadata.title || "",
    desc: metadata.desc || "",
    size: metadata.size || 0,
    filename: coll.config.sourceName,
    loadUrl: coll.config.loadUrl,
    sourceUrl: coll.config.sourceUrl,
    id: coll.name,
    ctime: coll.config.ctime,
    mtime: metadata.mtime || coll.config.ctime,
    onDemand: coll.config.onDemand,
  };

  if (metadata.ipfsPins) {
    res.ipfsPins = metadata.ipfsPins;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return res;
}

// ===========================================================================
export class RangeError {
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info: Record<string, any>;

  constructor(info = {}) {
    this.info = info;
  }

  toString() {
    return JSON.stringify(this.info);
  }
}

export class AuthNeededError extends RangeError {}

export class AccessDeniedError extends RangeError {}

export class Canceled {}

export async function sleep(millis: number) {
  return new Promise((resolve) => setTimeout(resolve, millis));
}
