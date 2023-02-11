import yaml from "js-yaml";

import { MAX_FULL_DOWNLOAD_SIZE } from "../utils.js";
import { WARCLoader } from "../warcloader.js";
import { ZipRangeReader } from "./ziprangereader.js";

import { verifyWACZSignature } from "./certutils.js";

export const MAIN_PAGES_JSON = "pages/pages.jsonl";
export const EXTRA_PAGES_JSON = "pages/extraPages.jsonl";

export const DATAPACKAGE_JSON = "datapackage.json";

const PAGE_BATCH_SIZE = 500;


// ============================================================================
export class SingleWACZLoader
{
  constructor(loader, config, loadId = null) {
    this.loader = loader;
    this.config = config;
    this.loadId = loadId;

    this.canLoadOnDemand = config.onDemand;

    this.zipreader = null;

    this.waczname = config.loadUrl;
  }

  async load(db, progressUpdate, fullTotalSize) {
    this.zipreader = db.zipreader ? db.zipreader : new ZipRangeReader(this.loader);

    const entries = await this.zipreader.load(true);

    //todo: a bit hacky, store the full arrayBuffer for blob loader
    // if size less than MAX_FULL_DOWNLOAD_SIZE
    if (this.canLoadOnDemand) {
      if (db.fullConfig && this.loader.arrayBuffer &&
        this.loader.arrayBuffer.byteLength <= MAX_FULL_DOWNLOAD_SIZE) {
        if (!db.fullConfig.extra) {
          db.fullConfig.extra = {};
        }
        db.fullConfig.extra.arrayBuffer = this.loader.arrayBuffer;
      }
    }

    let metadata;

    let datapackageDigest = null;

    if (entries["datapackage-digest.json"]) {
      datapackageDigest = await this.loadDigestData(db, "datapackage-digest.json");
    }

    if (entries[DATAPACKAGE_JSON]) {
      metadata = await this.loadMetadata(db, entries, DATAPACKAGE_JSON, datapackageDigest);
    } else if (entries["webarchive.yaml"]) {
      metadata = await this.loadMetadataYAML(db, entries, "webarchive.yaml");
    }

    if (this.canLoadOnDemand) {
      // just add wacz file here
      //await db.addWACZFile(this.waczname, entries);
      await db.addNewWACZ(this.waczname, entries);
    } else {

      await this.loadWACZFull(db, entries, progressUpdate, fullTotalSize);
    }

    return metadata || {};
  }

  async loadWACZFull(db, entries, progressUpdateCallback = null, fullTotalSize = 0) {
    let offsetTotal = 0;

    const progressUpdate = (percent, error, offset/*, total*/) => {
      offset += offsetTotal;
      if (progressUpdateCallback && fullTotalSize) {
        progressUpdateCallback(Math.round(offset * 100.0 / fullTotalSize), null, offset, fullTotalSize);
      }
    };

    // load CDX and IDX
    for (const filename of Object.keys(entries)) {
      const entryTotal = this.zipreader.getCompressedSize(filename);
      if (filename.endsWith(".warc.gz") || filename.endsWith(".warc")) {
        await this.loadWARC(db, filename, progressUpdate, entryTotal);
      }

      offsetTotal += entryTotal;
    }
  }

  async loadWARC(db, filename, progressUpdate, total) {
    const {reader} = await this.zipreader.loadFile(filename, {unzip: true});

    const loader = new WARCLoader(reader, null, filename);
    loader.detectPages = false;

    return await loader.load(db, progressUpdate, total);
  }

  async loadTextEntry(db, filename, expectedHash) {
    const { reader, hasher } = await this.zipreader.loadFile(filename, {computeHash: !!expectedHash});
    const text = new TextDecoder().decode(await reader.readFully());
    if (expectedHash && hasher) {
      await db.addVerifyData(filename, expectedHash, hasher.getHash());
    }
    return text;
  }

  async loadDigestData(db, filename) {
    try {
      const digestData = JSON.parse(await this.loadTextEntry(db, filename));
      let datapackageHash;

      if (digestData.path === DATAPACKAGE_JSON && digestData.hash) {
        datapackageHash = digestData.hash;
      }

      if (!digestData.signedData || digestData.signedData.hash !== datapackageHash) {
        await db.addVerifyData("signature");
        return;
      }

      await db.addVerifyData("datapackageHash", datapackageHash);

      const results = await verifyWACZSignature(digestData.signedData);

      await db.addVerifyDataList(results);

      return datapackageHash;

    } catch (e) {
      console.warn(e);
    }
  }

  // New WACZ 1.0.0 Format
  async loadMetadata(db, entries, filename, expectedDigest) {
    const text = await this.loadTextEntry(db, filename, expectedDigest);

    const root = JSON.parse(text);

    if (root.config !== undefined && db.initConfig) {
      db.initConfig(root.config);
    }

    const metadata = root.metadata || {};

    let pagesHash = null;

    for (const res of root.resources) {
      if (res.path === MAIN_PAGES_JSON) {
        pagesHash = res.hash;
        await db.addVerifyData(res.path, res.hash);
      } else if (res.path.endsWith(".idx") || res.path.endsWith(".cdx")) {
        await db.addVerifyData(res.path, res.hash);
      }
    }

    // All Pages
    if (entries[MAIN_PAGES_JSON]) {
      //const result = await this.zipreader.loadFile(filename, {unzip: true, computeHash: true});
      const pageInfo = await loadPages(db, this.zipreader, this.waczname, MAIN_PAGES_JSON, pagesHash);

      if (pageInfo.hasText) {
        db.textIndex = metadata.textIndex = MAIN_PAGES_JSON;
      }
    }

    if (entries[EXTRA_PAGES_JSON]) {
      db.textIndex = metadata.textIndex = EXTRA_PAGES_JSON;
    }

    return metadata;
  }

  // Old WACZ 0.1.0 Format
  async loadMetadataYAML(db, entries, filename) {
    const text = await this.loadTextEntry(db, filename);

    const root = yaml.load(text);

    const metadata = {
      desc: root.desc,
      title: root.title
    };

    if (root.textIndex) {
      metadata.textIndex = root.textIndex;
      if (!root.config) {
        root.config = {};
      }
      root.config.textIndex = root.textIndex;
    }

    if (root.config !== undefined) {
      db.initConfig(root.config);
    }

    if (!metadata.title) {
      metadata.title = this.config.sourceName;
    }

    // All pages
    const pages = root.pages || [];

    if (pages && pages.length) {
      await db.addPages(pages);
    } else {
      if (entries["pages.csv"]) {
        await db.loadPagesCSV(db, "pages.csv");
      }
    }

    // Curated Pages
    const pageLists = root.pageLists || [];

    if (pageLists && pageLists.length) {
      await db.addCuratedPageLists(pageLists, "pages", "show");
    }

    return metadata;
  }
}

// ==========================================================================
export class JSONMultiWACZLoader
{
  constructor(json, baseUrl) {
    this.json = json;
    this.baseUrl = baseUrl;
  }

  async load(db)  {
    const metadata = {
      title: this.json.title,
      desc: this.json.description
    };

    const files = this.loadFiles(this.baseUrl);

    await db.syncWACZ(files);

    return metadata;
  }

  loadFiles() {
    return this.json.resources.map((res) => {
      const url = new URL(res.path, this.baseUrl).href;
      const hash = res.hash;
      const name = res.name;
      return {name, hash, url};
    });
  }
}

// ==========================================================================
export async function loadPages(db, zipreader, waczname, filename = MAIN_PAGES_JSON, expectedHash = null) {
  const {reader, hasher} = await zipreader.loadFile(filename, {unzip: true, computeHash: true});
  //const {reader, hasher} = result;

  let pageListInfo = null;

  let pages = [];

  for await (const textLine of reader.iterLines()) {
    const page = JSON.parse(textLine);

    page.wacz = waczname;

    if (!pageListInfo) {
      pageListInfo = page;
      continue;
    }

    pages.push(page);

    if (pages.length === PAGE_BATCH_SIZE) {
      await db.addPages(pages);
      pages = [];
    }
  }

  if (pages.length) {
    await db.addPages(pages);
  }

  if (hasher && expectedHash) {
    await db.addVerifyData(filename, expectedHash, hasher.getHash());
  }

  return pageListInfo;
}
