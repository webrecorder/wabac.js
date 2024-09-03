import { type ArchiveLoader, type DBStore, type PageEntry } from "./types";

const DEFAULT_BATCH_SIZE = 1000;

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
};

// ===========================================================================
abstract class BaseParser implements ArchiveLoader {
  batchSize: number;
  promises: Promise<void>[] = [];
  batch: ResourceEntry[] = [];
  count = 0;
  dupeSet = new Set<string>();
  //TODO
  db: any;

  constructor(batchSize = DEFAULT_BATCH_SIZE) {
    this.batchSize = batchSize;
  }

  addPage(page: PageEntry) {
    this.promises.push(this.db.addPage(page));
  }

  isBatchFull() {
    return this.batch.length >= this.batchSize;
  }

  addResource(res: ResourceEntry) {
    if (this.isBatchFull()) {
      this.flush();
    }

    if (Number.isNaN(res.ts)) {
      console.warn("Skipping resource with missing/invalid ts: " + res.url);
      return;
    }

    const key = res.url + " " + res.ts;

    if (res.mime === "warc/revisit") {
      if (this.dupeSet.has(key)) {
        console.warn(
          "Skipping duplicate revisit, prevent overriding non-revisit",
        );
        return;
      }
    } else {
      this.dupeSet.add(key);
    }

    this.batch.push(res);
  }

  flush() {
    if (this.batch.length > 0) {
      this.promises.push(this.db.addResources(this.batch));
    }
    console.log(`Read ${(this.count += this.batch.length)} records`);
    this.batch = [];
  }

  async finishIndexing() {
    this.flush();

    this._finishLoad();

    try {
      await Promise.all(this.promises);
    } catch (e) {
      console.warn(e);
    }

    this.promises = [];
  }

  _finishLoad() {}

  abstract load(
    db: DBStore,
    progressUpdateCallback?: any,
    totalLength?: number,
  ): Promise<void>;
}

export { BaseParser };
