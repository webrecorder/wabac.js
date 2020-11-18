
const BATCH_SIZE = 1000;

class BaseParser
{
  constructor() {
    this.promises = [];

    this.batch = [];
    this.count = 0;
  }

  addPage(page) {
    this.promises.push(this.db.addPage(page));
  }

  addResource(res) {
    if (this.batch.length >= BATCH_SIZE) {
      this.flush();
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

export { BaseParser }