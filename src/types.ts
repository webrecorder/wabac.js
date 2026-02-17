import { type BaseAsyncIterReader } from "warcio";
import { type ArchiveRequest } from "./request";
import { type ArchiveResponse } from "./response";
import { type BlockLoaderExtra } from "./blockloaders";

export type Source = {
  start: number;
  length: number;
  path: string;
  wacz?: string;
};

// known options that can be included in WARC header as WARC-JSON-Metadata: <extraOpts json>
export type ExtraOpts = {
  // Video options
  maxBitrate?: number;
  adaptive_max_resolution?: number;
  maxRes?: number;
  adaptive_max_bandwidth?: number;
  maxBand?: number;

  // Pixel Ratio
  pixelRatio?: number;

  // Local/Session Storage
  storage?: string;

  // IP Info
  ipType?: string;

  // Cert Info
  cert?: {
    issuer: string;
    ctc: string;
  };

  // if content was rewritten
  rewritten?: number;

  // if disabling media source extensions
  disableMSE?: number;
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
  extraOpts?: ExtraOpts | null;
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

  mime?: string;
  depth?: number;
  status?: number;
  favIconUrl?: string;
  wacz?: string;
  waczhash?: string;
  isSeed?: boolean;

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
  ) => Promise<CollMetadata | undefined>;
}

export type CollMetadata = {
  fullSize?: number;
  size?: number;
  mtime?: number;
  title?: string;
  desc?: string;
};

export type ExtraConfig = {
  prefix?: string;
  type?: string;
  headers?: Record<string, string>;

  injectScripts?: string[];
  noRewritePrefixes?: string[] | null;

  noPostToGet?: boolean;
  convertPostToGet?: boolean;

  coHeaders?: boolean;
  csp?: string;

  injectRelCanon?: boolean;

  baseUrlSourcePrefix?: string;
  baseUrl?: string;
  baseUrlHashReplay?: boolean;
  baseUrlAppendReplay?: boolean;

  liveRedirectOnNotFound?: boolean;
  adblockUrl?: string;

  proxyTLD?: string;
  localTLD?: string;

  proxyOrigin?: string;
  proxyTs?: string;
  proxyBannerUrl?: string;
  proxyPathOnly?: boolean;
  archivePrefix?: string;
  archiveMod?: string;
  isLive?: boolean;
};

export type CollConfig = {
  root?: boolean;

  dbname: string;

  ctime?: number;

  decode?: boolean;

  sourceUrl: string;

  extraConfig?: ExtraConfig;

  topTemplateUrl?: string;

  metadata?: CollMetadata;

  loadUrl?: string;

  size?: number;

  headers?: Record<string, string>;

  extra?: BlockLoaderExtra;

  noCache?: boolean;

  remotePrefix?: string;

  sourceName?: string;

  onDemand?: boolean;
};

export type RWOpts = {
  response?: ArchiveResponse;
  prefix?: string;
  baseUrl?: string;

  isModule?: boolean;
  isStrict?: boolean;
  inline?: boolean;
  isWorker?: boolean;
  moduleInsert?: string;

  rewriteUrl?: (url: string) => string;

  save?: ExtraOpts;
};

export type PreloadResources = {
  name: string;
  crawlId: string;
};

export type WACZPageEntry = {
  id: string;
  url: string;
  title?: string;
  ts: number;
  mime: string;
  status: number;
  depth: number;
  favIconUrl?: string;
  filename: string;
  isSeed: boolean;
  crawl_id?: string;
};

export type MultiWACZJsonSpec = {
  resources: { name: string; path: string; hash: string; crawlId?: string }[];
  profile: string;
  initialPages?: WACZPageEntry[];
  preloadResources?: PreloadResources[];
  totalPages?: number;
  pagesQueryUrl?: string;
};

export type DataPackageWithRelation = {
  relation?: {
    requires: { filename: string; hash: string; crawlId?: string }[];
  };
};

export type WACZCollConfig = CollConfig & {
  dbname: string;
  noCache?: boolean;
  decode?: unknown;
  loadUrl: string;
  metadata?: CollMetadata &
    Partial<MultiWACZJsonSpec> & {
      textIndex?: string;
    };
  extraConfig?: ExtraConfig & {
    decodeResponses?: unknown;
    hostProxy?: boolean;
    fuzzy?: [RegExp | string, string][];
    textIndex?: string;
  };
};
