import { sleep } from "./utils";

// ===========================================================================
const GC_INTERVAL = 600000;
  
// defined during webpack build
// eslint-disable-next-line no-undef
const IPFS_CORE_JS = __IPFS_CORE_URL__;

let client = null;

// ===========================================================================
class IPFSClient
{
  constructor(customPreload = false) {
    this.ipfs = null;
    this._initingIPFS = null;
    this.ipfsGC = null;

    this.customPreload = customPreload;
    this.preloadNodes = null;

    //this._currentPreload = null;
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
      const loadFunc = new Function(await resp.text());
      loadFunc();
    }
  
    this.ipfs = await self.IpfsCore.create(this.initOptions);
  
    this.resetGC();

    if (this.customPreload) {
      //const allConfig = await this.ipfs.config.getAll();
      //this.preloadNodes = allConfig.Addresses.Delegates.map(x => multiAddToUri(x));
      this.preloadNodes = this.ipfsCustomPreloadURLs || [
        "https://node0.preload.ipfs.io",
        "https://node1.preload.ipfs.io",
        "https://node2.preload.ipfs.io",
        "https://node3.preload.ipfs.io",
      ];
    }
  }

  async restart() {
    await this.ipfs.stop();
    this._initingIPFS = null;
    this.ipfs = null;
    await this.initIPFS();
  }

  get initOptions() {
    let opts = {
      init: {emptyRepo: true},
      preload: {enabled: !this.customPreload}
    };

    // init from globally set self.ipfsOpts, if available
    try {
      opts = {...opts, ...self.ipfsOpts};
    } catch(e) {
      // ignore invalid options
    }

    return opts;
  }

  async runGC() {
    let count = 0;
  
    // eslint-disable-next-line no-unused-vars
    for await (const _ of this.ipfs.repo.gc()) {
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
    const name = filename.slice(filename.lastIndexOf("/") + 1);

    if (this.customPreload) {
      await this.cacheDirToPreload(filename);
    }

    for await (const file of this.ipfs.ls(filename, {preload: false})) {
      if (file.name == name && file.type === "file") {
        return file.size;
      }
    }

    return null;
  }

  async cat(filename, opts) {
    this.resetGC();

    if (this.customPreload) {
      await this.preloadCat(filename, opts);
    }
    return this.ipfs.cat(filename, opts);
  }

  getPreloadURL() {
    if (!this.preloadNodes || !this.preloadNodes.length) {
      return null;
    }

    const inx = parseInt(Math.random() * this.preloadNodes.length);
    return this.preloadNodes[inx];
  }

  async cacheDirToPreload(hash, timeout = 20000, retries = 5) {
    for (let i = 0; i < retries; i++) {
      const preloadBaseUrl = this.getPreloadURL();
      if (!preloadBaseUrl) {
        return;
      }

      const params = new URLSearchParams({"arg": hash});
      const url = `${preloadBaseUrl}/api/v0/ls?${params}`;

      const abort = new AbortController();
      const signal = abort.signal;

      try {
        const resp = await Promise.race([fetch(url, {signal, method: "HEAD"}), sleep(timeout)]);
        // if got response, success and can return
        if (resp) {
          return true;
        }

        abort.abort();

        // if timed out establishing connection, (sleep finished first), likely no transport
        // attempt to restart ipfs and try again
        await this.restart();
        await sleep(500);

      } catch (e) {
        console.log("try again");
        await sleep(500);
        //this._currentPreload = null;
      }
    }

    return false;
  }

  preloadCat(filename, opts) {
    const preloadBaseUrl = this.getPreloadURL();
    if (!preloadBaseUrl) {
      return;
    }

    const arg = filename;
    const {offset, length} = opts;

    const params = new URLSearchParams({arg, offset, length});

    const url = `${preloadBaseUrl}/api/v0/cat?${params}`;

    return fetch(url, {method: "HEAD"});
  }
}

// ===========================================================================
async function initIPFS()
{
  if (!client) {
    client = new IPFSClient(!!self.ipfsCustomPreload);
  }
  await client.initIPFS();
  return client;
}

export { IPFSClient, initIPFS };
