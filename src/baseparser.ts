const DEFAULT_BATCH_SIZE = 1000;


// ===========================================================================
class BaseParser
{
  batchSize: number;
  promises: Promise<void>[] = [];
  batch: string[] = [];
  count = 0;
  dupeSet = new Set<string>();
  //TODO
  db: any;

  constructor(batchSize = DEFAULT_BATCH_SIZE) {
    this.batchSize = batchSize;
  }

  addPage(page) {
    this.promises.push(this.db.addPage(page));
  }

  isBatchFull() {
    return this.batch.length >= this.batchSize;
  }

  addResource(res) {
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
        console.warn("Skipping duplicate revisit, prevent overriding non-revisit");
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
    console.log(`Read ${this.count += this.batch.length} records`);
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

  _finishLoad() {

  }
}

export { BaseParser };