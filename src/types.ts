import { type ArchiveRequest } from "./request";
import { type ArchiveResponse } from "./response";

export type ResourceEntry = {
  url: string;
  ts: number;

  digest?: string | null;
  status?: number;
  mime?: string;

  respHeaders?: Record<string, string> | null;
  reqHeaders?: Record<string, string> | null;
  recordDigest?: string | null;
  payload?: Uint8Array | null;
  reader?: AsyncIterable<Uint8Array> | Iterable<Uint8Array> | null;
  referrer?: string | null;
  extraOpts?: Record<string, any> | null;
  pageId?: string | null;
  origURL?: string | null;
  origTS?: number | null;
  source?: object;
  requestUrl?: string | null;
  method?: string | null;
  requestBody?: Uint8Array;
  loaded?: boolean;
  statusText?: string;

  "req.http:cookie"?: string;
};

export type PageEntry = {
  url: string;

  date?: string | null;
  datetime?: string | null;
  ts?: number | string;

  title?: string;
  id?: string;
  state?: number;

  timestamp?: string;

  pos?: number;
  list?: any;
};

export type DigestRefCount = {
  digest: string;
  count: number;
  size: number;
};

export type ResAPIResponse = {
  url: string;
  date: string;
  ts: string;
  mime: string;
  status: number;
};

export interface DBStore {
  getResource: (
    request: ArchiveRequest,
    prefix: string,
    event?: FetchEvent,
    opts?: Record<string, any>,
  ) => Promise<ArchiveResponse | Response | null>;

  getAllPages: () => Promise<any[]>;
}

export interface ArchiveLoader {
  load: (
    db: DBStore,
    progressUpdateCallback?: any,
    totalLength?: number,
  ) => Promise<void>;
}
