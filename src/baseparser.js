
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
    //this.promises.push(this.db.addResource(res));

    if (this.batch.length >= BATCH_SIZE) {
      this.promises.push(this.db.addResources(this.batch));
      this.batch = [];
      console.log(`Read ${this.count += BATCH_SIZE} records`);
    }

    this.batch.push(res);
  }

  async finishIndexing() {
    if (this.batch.length > 0) {
      this.promises.push(this.db.addResources(this.batch));
    }

    console.log(`Indexed ${this.count += this.batch.length} records`);

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