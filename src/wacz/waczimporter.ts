import yaml from "js-yaml";

import { verifyWACZSignature } from "./certutils";
import { MultiWACZ } from "./multiwacz";
import { WACZFile } from "./waczfile";

export const MAIN_PAGES_JSON = "pages/pages.jsonl";
export const EXTRA_PAGES_JSON = "pages/extraPages.jsonl";

export const DATAPACKAGE_JSON = "datapackage.json";
export const DATAPACKAGE_DIGEST_JSON = "datapackage-digest.json";
const WEBARCHIVE_YAML = "webarchive.yaml";

const PAGE_BATCH_SIZE = 500;

// ==========================================================================
export class WACZImporter
{
  store: MultiWACZ;
  file: WACZFile;
  isRoot: boolean;
  waczname: string;

  constructor(store, file, isRoot = true) {
    this.file = file;
    this.waczname = file.waczname;
    this.store = store;
    this.isRoot = isRoot;
  }

  async loadFileFromWACZ(filename, opts) {
    if (this.store.loadFileFromWACZ) {
      return await this.store.loadFileFromWACZ(this.file, filename, opts);
    } else {
      return await this.file.loadFile(filename, opts);
    }
  }

  async load() {
    // process loading
    let metadata;

    let datapackageDigest = null;

    if (this.file.containsFile(DATAPACKAGE_DIGEST_JSON)) {
      datapackageDigest = await this.loadDigestData(DATAPACKAGE_DIGEST_JSON);
    }

    if (this.file.containsFile(DATAPACKAGE_JSON)) {
      metadata = await this.loadPackage(DATAPACKAGE_JSON, datapackageDigest);
    } else if (this.file.containsFile(WEBARCHIVE_YAML)) {
      metadata = await this.loadOldPackageYAML(WEBARCHIVE_YAML);
    }
    
    return metadata || {};
  }

  async loadTextFileFromWACZ(filename, expectedHash = "") : Promise<string> {
    const { reader, hasher } = await this.loadFileFromWACZ(filename, {computeHash: !!expectedHash});
    if (!reader) {
      return "";
    }
    
    const text = new TextDecoder().decode(await reader.readFully());
    if (expectedHash && hasher) {
      await this.store.addVerifyData(this.waczname, filename, expectedHash, hasher.getHash());
    }
    return text;
  }

  async loadDigestData(filename) {
    try {
      const digestData = JSON.parse(await this.loadTextFileFromWACZ(filename));
      let datapackageHash;

      if (digestData.path === DATAPACKAGE_JSON && digestData.hash) {
        datapackageHash = digestData.hash;
      }

      const store = this.store;
      const sigPrefix = this.isRoot ? "" : this.waczname + ":";

      if (!digestData.signedData || digestData.signedData.hash !== datapackageHash) {
        await store.addVerifyData(sigPrefix, "signature", "");
        return;
      }

      await store.addVerifyData(sigPrefix, "datapackageHash", datapackageHash);

      const results = await verifyWACZSignature(digestData.signedData);

      await store.addVerifyDataList(sigPrefix, results);

      return datapackageHash;

    } catch (e) {
      console.warn(e);
    }
  }

  async loadPackage(filename, expectedDigest) {
    const text = await this.loadTextFileFromWACZ(filename, expectedDigest);

    const root = JSON.parse(text);

    //todo: check
    if (this.isRoot && root.config !== undefined) {
      this.store.initConfig(root.config);
    }

    switch (root.profile) {
    case "data-package":
    case "wacz-package":
    case undefined:
    case null:
      return await this.loadLeafWACZPackage(root);

    case "multi-wacz-package":
      return await this.loadMultiWACZPackage(root);

    default:
      throw new Error(`Unknown package profile: ${root.profile}`);
    }
  }

  async loadMultiWACZPackage(root) {
    this.file.markAsMultiWACZ();
    await this.store.loadWACZFiles(root, this.file);
    return root;
  }

  async loadLeafWACZPackage(datapackage) {
    const metadata = datapackage.metadata || {};

    let pagesHash = null;

    for (const res of datapackage.resources) {
      if (res.path === MAIN_PAGES_JSON) {
        pagesHash = res.hash;
        await this.store.addVerifyData(this.waczname, res.path, res.hash);
      } else if (res.path.endsWith(".idx") || res.path.endsWith(".cdx")) {
        await this.store.addVerifyData(this.waczname, res.path, res.hash);
      }
    }

    // All Pages
    if (this.file.containsFile(MAIN_PAGES_JSON)) {
      const pageInfo : any = await this.loadPages(MAIN_PAGES_JSON, pagesHash);

      if (pageInfo.hasText) {
        this.store.textIndex = metadata.textIndex = MAIN_PAGES_JSON;
      }
    }

    if (this.file.containsFile(EXTRA_PAGES_JSON)) {
      this.store.textIndex = metadata.textIndex = EXTRA_PAGES_JSON;
    }

    return metadata;
  }

  // Old WACZ 0.1.0 Format
  async loadOldPackageYAML(filename) {
    const text = await this.loadTextFileFromWACZ(filename);

    const root = yaml.load(text);

    const metadata : Record<string, any> = {
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

    if (this.isRoot && root.config !== undefined) {
      this.store.initConfig(root.config);
    }

    if (!metadata.title) {
      metadata.title = this.store.config.sourceName;
    }

    // All pages
    const pages = root.pages || [];

    if (pages && pages.length) {
      await this.store.addPages(pages);
    }

    // Curated Pages
    const pageLists = root.pageLists || [];

    if (pageLists && pageLists.length) {
      await this.store.addCuratedPageLists(pageLists, "pages", "show");
    }

    return metadata;
  }

  async loadPages(filename = MAIN_PAGES_JSON, expectedHash = null) : Promise<Record<string, any>[]> {
    const {reader, hasher} = await this.loadFileFromWACZ(filename, {unzip: true, computeHash: true});

    if (!reader) {
      return [];
    }

    let pageListInfo = [];
  
    let pages : Record<string, any>[] = [];
  
    for await (const textLine of reader.iterLines()) {
      const page = JSON.parse(textLine);
  
      if (this.waczname) {
        page.wacz = this.waczname;
      }
  
      if (!pageListInfo) {
        pageListInfo = page;
        continue;
      }
  
      pages.push(page);
  
      if (pages.length === PAGE_BATCH_SIZE) {
        await this.store.addPages(pages);
        pages = [];
      }
    }
  
    if (pages.length) {
      await this.store.addPages(pages);
    }

    if (hasher && expectedHash) {
      await this.store.addVerifyData(this.waczname, filename, expectedHash, hasher.getHash());
    }

    return pageListInfo;
  }
}
