// ===========================================================================
const GC_INTERVAL = 600000;

const IPFS_CORE_JS = __IPFS_CORE_URL__;

let client = null;

// ===========================================================================
class IPFSClient
{
  constructor() {
    this.ipfs = null;
    this._initingIPFS = null;
    this.ipfsGC = null;
  }

  async initIPFS() {
    if (!this.ipfs) {
      try {
        if (!this._initingIPFS) {
          this._initingIPFS = this._doInitIPFS();
        }

        await this._initingIPFS;

      } catch (e) {
        console.warn(e);
      }
    }
  }

  async _doInitIPFS() {
    if (!IPFS_CORE_JS) {
      console.warn("Skipping IPFS init, no load URL");
      return;
    }

    if (!self.IpfsCore && IPFS_CORE_JS) {
      const resp = await fetch(IPFS_CORE_JS);
      eval(await resp.text());
    }
  
    this.ipfs = await self.IpfsCore.create({
      init: {emptyRepo: true},
      config: this.initConfig,
    });
  
    this.resetGC();
  }

  get initConfig() {
    return {};
  }

  async runGC() {
    let count = 0;
  
    for await (const res of this.ipfs.repo.gc()) {
      count++;
    }
    console.log(`IPFS GC, Removed ${count} blocks`);
  }

  async resetGC() {
    if (this.ipfsGC) {
      clearInterval(this.ipfsGC);
    }
  
    this.ipfsGC = setInterval(() => this.runGC(), GC_INTERVAL);
  }

  async getFileSize(filename) {
    let name = null;
    let iter = null;

    // workaround as ipfs.ls() on single file is broken
    // if no dir, use get
    const inx = filename.lastIndexOf("/");
    if (inx > 0) {
      const dir = filename.slice(0, inx);
      iter = this.ipfs.ls(dir, {preload: false});
      name = filename.slice(inx + 1);
    } else {
      iter = this.ipfs.get(filename, {preload: false});
      name = filename;
    }

    for await (const file of iter) {
      if (file.name == name && file.type === "file") {
        return file.size;
      }
    }

    return null;
  }

  cat(filename, opts) {
    this.resetGC();

    return this.ipfs.cat(filename, opts);
  }
}

// ===========================================================================
async function initIPFS()
{
  if (!client) {
    client = new IPFSClient();
  }
  await client.initIPFS();
  return client;
}

export { IPFSClient, initIPFS };
