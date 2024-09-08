import { type BaseAsyncIterReader } from "warcio";
import { type ArchiveRequest } from "./request";
import { type ArchiveResponse } from "./response";

export type Source = {
  start: number;
  length: number;
  path: string;
  wacz?: string;
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
  reader?: BaseAsyncIterReader | null;
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

export type RemoteResourceEntry = ResourceEntry & {
  source: Source;
};

export type PageEntry = {
  url: string;

  date?: string | null;
  datetime?: string | null;
  ts?: number;

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

export type CollConfig = {
  root?: string;
  dbname: string;

  ctime?: number;

  decode?: boolean;

  sourceUrl: string;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraConfig?: Record<string, any>;

  topTemplateUrl?: string;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;

  loadUrl?: string;

  size?: number;

  headers?: Record<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra?: Record<string, any>;

  noCache?: boolean;

  remotePrefix?: string;

  sourceName?: string;

  onDemand?: boolean;
};

export type WACZCollConfig = CollConfig & {
  dbname: string;
  noCache?: boolean;
  decode?: unknown;
  loadUrl: string;
  metadata?: {
    textIndex?: string;
  };
  extraConfig?: {
    decodeResponses?: unknown;
    hostProxy?: boolean;
    fuzzy?: [RegExp | string, string][];
    textIndex?: string;
  };
};
