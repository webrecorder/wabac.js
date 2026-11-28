import yaml from "js-yaml";

import { type VerifySigData, verifyWACZSignature } from "./certutils";
import { type MultiWACZ } from "./multiwacz";
import { type WACZFile } from "./waczfile";
import { type PageEntry } from "../types";

export const MAIN_PAGES_JSON = "pages/pages.jsonl";
export const EXTRA_PAGES_JSON = "pages/extraPages.jsonl";

export const DATAPACKAGE_JSON = "datapackage.json";
export const DATAPACKAGE_DIGEST_JSON = "datapackage-digest.json";
const WEBARCHIVE_YAML = "webarchive.yaml";

const PAGE_BATCH_SIZE = 500;

type DatapackageDigest = {
  hash: string;
  path: string;
  signedData?: VerifySigData;
};

// ==========================================================================
export class WACZImporter {
  store: MultiWACZ;
  file: WACZFile;
  isRoot: boolean;
  waczname: string;

  constructor(store: MultiWACZ, file: WACZFile, isRoot = true) {
    this.file = file;
    this.waczname = file.waczname || "";
    this.store = store;
    this.isRoot = isRoot;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadFileFromWACZ(filename: string, opts: Record<string, any>) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.store.loadFileFromWACZ) {
      return await this.store.loadFileFromWACZ(this.file, filename, opts);
    } else {
      return await this.file.loadFile(filename, opts);
    }
  }

  async load() {
    // process loading
    let metadata;

    let datapackageDigest = "";

    if (this.file.containsFile(DATAPACKAGE_DIGEST_JSON)) {
      datapackageDigest = await this.loadDigestData(DATAPACKAGE_DIGEST_JSON);
    }

    if (this.file.containsFile(DATAPACKAGE_JSON)) {
      metadata = await this.loadPackage(DATAPACKAGE_JSON, datapackageDigest);
    } else if (this.file.containsFile(WEBARCHIVE_YAML)) {
      metadata = await this.loadOldPackageYAML(WEBARCHIVE_YAML);
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return metadata || {};
  }

  async loadTextFileFromWACZ(
    filename: string,
    expectedHash = "",
  ): Promise<string> {
    const { reader, hasher } = await this.loadFileFromWACZ(filename, {
      computeHash: !!expectedHash,
    });
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!reader) {
      return "";
    }

    const text = new TextDecoder().decode(await reader.readFully());
    if (expectedHash && hasher) {
      await this.store.addVerifyData(
        this.waczname,
        filename,
        expectedHash,
        hasher.getHash(),
      );
    }
    return text;
  }

  async loadDigestData(filename: string) {
    try {
      const digestData = JSON.parse(
        await this.loadTextFileFromWACZ(filename),
      ) as DatapackageDigest;
      let datapackageHash = "";

      if (digestData.path === DATAPACKAGE_JSON && digestData.hash) {
        datapackageHash = digestData.hash;
      }

      const store = this.store;
      const sigPrefix = this.getSigPrefix();

      if (
        !digestData.signedData ||
        digestData.signedData.hash !== datapackageHash
      ) {
        //await store.addVerifyData(sigPrefix, "signature", "");
        return "";
      }

      await store.addVerifyData(
        sigPrefix,
        "datapackageHash",
        digestData.signedData.hash,
        datapackageHash,
      );

      const results = await verifyWACZSignature(digestData.signedData);

      await store.addVerifyDataList(sigPrefix, results);

      return datapackageHash;
    } catch (e) {
      console.warn(e);
    }

    return "";
  }

  async loadPackage(filename: string, expectedDigest: string) {
    const text = await this.loadTextFileFromWACZ(filename, expectedDigest);

    const root = JSON.parse(text);

    //todo: check
    if (this.isRoot && root.config !== undefined) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      this.store.initConfig(root.config);
    }

    switch (root.profile) {
      case "data-package":
      case "wacz-package":
      case undefined:
      case null:
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument
        return await this.loadLeafWACZPackage(root);

      case "multi-wacz-package":
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await this.loadMultiWACZPackage(root);

      default:
        throw new Error(`Unknown package profile: ${root.profile}`);
    }
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadMultiWACZPackage(root: any) {
    this.file.markAsMultiWACZ();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await this.store.loadWACZFiles(root, this.file);

    this.store.maxFallbackLookups = -1;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return root;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadLeafWACZPackage(datapackage: Record<string, any>) {
    // @ts-expect-error [TODO] - TS4111 - Property 'metadata' comes from an index signature, so it must be accessed with ['metadata'].
    const metadata = datapackage.metadata || {};

    const sigPrefix = this.getSigPrefix();

    let pagesHash = null;

    // @ts-expect-error [TODO] - TS4111 - Property 'resources' comes from an index signature, so it must be accessed with ['resources'].
    for (const res of datapackage.resources) {
      if (res.path === MAIN_PAGES_JSON) {
        pagesHash = res.hash;
        // [TODO]
        await this.store.addVerifyData(
          sigPrefix,
          res.path as string,
          res.hash as string,
        );
      } else if (res.path.endsWith(".idx") || res.path.endsWith(".cdx")) {
        // [TODO]
        await this.store.addVerifyData(
          sigPrefix,
          res.path as string,
          res.hash as string,
        );
      }
    }

    // All Pages
    if (this.file.containsFile(MAIN_PAGES_JSON)) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      const pageInfo: any = await this.loadPages(MAIN_PAGES_JSON, pagesHash);

      if (pageInfo.hasText) {
        this.store.textIndex = metadata.textIndex = MAIN_PAGES_JSON;
      }
    }

    if (this.file.containsFile(EXTRA_PAGES_JSON)) {
      this.store.textIndex = metadata.textIndex = EXTRA_PAGES_JSON;
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return metadata;
  }

  // Old WACZ 0.1.0 Format
  async loadOldPackageYAML(filename: string) {
    const text = await this.loadTextFileFromWACZ(filename);

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root: Record<string, any> = yaml.load(text) as Record<string, any>;

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: Record<string, any> = {
      // @ts-expect-error [TODO] - TS4111 - Property 'desc' comes from an index signature, so it must be accessed with ['desc'].
      desc: root.desc,
      // @ts-expect-error [TODO] - TS4111 - Property 'title' comes from an index signature, so it must be accessed with ['title'].
      title: root.title,
    };

    // @ts-expect-error [TODO] - TS4111 - Property 'textIndex' comes from an index signature, so it must be accessed with ['textIndex'].
    if (root.textIndex) {
      // @ts-expect-error [TODO] - TS4111 - Property 'textIndex' comes from an index signature, so it must be accessed with ['textIndex']. | TS4111 - Property 'textIndex' comes from an index signature, so it must be accessed with ['textIndex'].
      metadata.textIndex = root.textIndex;
      // @ts-expect-error [TODO] - TS4111 - Property 'config' comes from an index signature, so it must be accessed with ['config'].
      if (!root.config) {
        // @ts-expect-error [TODO] - TS4111 - Property 'config' comes from an index signature, so it must be accessed with ['config'].
        root.config = {};
      }
      // @ts-expect-error [TODO] - TS4111 - Property 'config' comes from an index signature, so it must be accessed with ['config']. | TS4111 - Property 'textIndex' comes from an index signature, so it must be accessed with ['textIndex'].
      root.config.textIndex = root.textIndex;
    }

    // @ts-expect-error [TODO] - TS4111 - Property 'config' comes from an index signature, so it must be accessed with ['config'].
    if (this.isRoot && root.config !== undefined) {
      // @ts-expect-error [TODO] - TS4111 - Property 'config' comes from an index signature, so it must be accessed with ['config'].
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      this.store.initConfig(root.config);
    }

    // @ts-expect-error [TODO] - TS4111 - Property 'title' comes from an index signature, so it must be accessed with ['title'].
    if (!metadata.title) {
      // @ts-expect-error [TODO] - TS4111 - Property 'title' comes from an index signature, so it must be accessed with ['title']. | TS2339 - Property 'sourceName' does not exist on type 'Config'.
      metadata.title = this.store.config.sourceName;
    }

    // All pages
    // @ts-expect-error [TODO] - TS4111 - Property 'pages' comes from an index signature, so it must be accessed with ['pages'].
    const pages = root.pages || [];

    if (pages?.length) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await this.store.addPages(pages);
    }

    // Curated Pages
    // @ts-expect-error [TODO] - TS4111 - Property 'pageLists' comes from an index signature, so it must be accessed with ['pageLists'].
    const pageLists = root.pageLists || [];

    if (pageLists?.length) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await this.store.addCuratedPageLists(pageLists, "pages", "show");
    }

    return metadata;
  }

  async loadPages(
    filename = MAIN_PAGES_JSON,
    expectedHash = null, // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<Record<string, any>[]> {
    const { reader, hasher } = await this.loadFileFromWACZ(filename, {
      unzip: true,
      computeHash: true,
    });

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!reader) {
      return [];
    }

    let pageListInfo = null;

    let pages: PageEntry[] = [];

    for await (const textLine of reader.iterLines()) {
      const page = JSON.parse(textLine);

      if (this.waczname) {
        page.wacz = this.waczname;
      }

      if (!pageListInfo) {
        pageListInfo = page;
        continue;
      }

      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      pages.push(page);

      if (pages.length === PAGE_BATCH_SIZE) {
        await this.store.addPages(pages);
        pages = [];
      }
    }

    if (pages.length) {
      await this.store.addPages(pages);
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (hasher && expectedHash) {
      await this.store.addVerifyData(
        this.getSigPrefix(),
        filename,
        expectedHash,
        hasher.getHash(),
      );
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return pageListInfo;
  }

  getSigPrefix() {
    //return this.isRoot ? "" : this.waczname + ":";
    return this.waczname;
  }
}
