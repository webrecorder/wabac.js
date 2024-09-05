import { type ArchiveRequest } from "./request";
import { type ArchiveResponse } from "./response";

export type Source = {
  start: number;
  length: number;
  path: string;
};

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
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraOpts?: Record<string, any> | null;
  pageId?: string | null;
  origURL?: string | null;
  origTS?: number | null;
  source?: Source;
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
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list?: any;
};

export type DigestRefCount = {
  digest: string;
  count: number | undefined;
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
    event: FetchEvent,
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts?: Record<string, any>,
  ) => Promise<ArchiveResponse | Response | null>;

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAllPages: () => Promise<any[]>;
}

export interface ArchiveLoader {
  load: (
    db: DBStore,
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progressUpdateCallback?: any,
    totalLength?: number | undefined,
  ) => Promise<void>;
}
