
import { ZipRangeReader } from "./ziprangereader";
import { OnDemandPayloadArchiveDB } from "./remotearchivedb";
import { SingleRecordWARCLoader } from "./warcloader";
import { CDXLoader } from "./cdxloader";
import { tsToDate } from "./utils";
import { getSurt } from "warcio";
import { createLoader } from "./blockloaders";

const PAGE_BATCH_SIZE = 500;

const MAIN_PAGES_JSON = "pages/pages.jsonl";

const INDEX_NOT_LOADED = 0;
const INDEX_CDX = 1;
const INDEX_IDX = 2;


// ==========================================================================
export class MultiWACZCollection extends OnDemandPayloadArchiveDB
{
  constructor(config) {
    super(config.dbname);
    this.config = config;

    this.waczfiles = {};

    this._updatedInterval = 30000;
  }

  _initDB(db, oldV, newV, tx) {
    super._initDB(db, oldV, newV, tx);

    if (!oldV) {
      db.createObjectStore("ziplines", { keyPath: ["waczname", "prefix"] });

      db.createObjectStore("waczfiles", { keyPath: "waczname"} );
    }
  }

  async init() {
    await super.init();

    const fileDatas = await this.db.getAll("waczfiles") || [];

    for (const file of fileDatas) {
      this.waczfiles[file.waczname] = file;
    }

    this.initLoader();
  }

  initLoader() {
    const config = this.config;

    this.indexLoader = createLoader({
      url: config.loadUrl,
      headers: config.headers,
      size: config.size,
      extra: config.extra
    });

    this.checkUpdates();

    this._updateId = setInterval(() => this.checkUpdates(), this._updatedInterval);
  }

  async checkUpdates() {
    const {response} = await this.indexLoader.doInitialFetch(false);
    if (response.status !== 206 && response.status !== 200) {
      console.warn("WACZ update failed from: " + this.config.loadUrl);
      return;
    }
    const loader = new JSONMultiWACZLoader(await response.json(), this.config.loadUrl);
    const files = loader.loadFiles();
    await this.syncWacz(files);
  }

  async syncWacz(files) {
    const promises = [];

    for (const waczname of files) {
      if (!this.waczfiles[waczname]) {
        promises.push(this.loadNewWacz(waczname));
      }
    }

    if (promises.length) {
      await Promise.allSettled(promises);
    }
  }

  async loadNewWacz(waczname) {
    const loader = this.getBlockLoader(waczname);

    const zipreader = new ZipRangeReader(loader);

    const entries = await zipreader.load(true);

    const filedata = {waczname, entries, indexType: INDEX_NOT_LOADED};

    await this.db.put("waczfiles", filedata);

    this.waczfiles[waczname] = filedata;

    await this.loadPages(zipreader, waczname);
  }

  async loadPages(zipreader, waczname) {
    const reader = await zipreader.loadFile(MAIN_PAGES_JSON, {unzip: true});

    await this.updateEntriesIfNeeded(zipreader, waczname);

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
        await this.addPages(pages);
        pages = [];
      }
    }

    if (pages.length) {
      await this.addPages(pages);
    }

    return pageListInfo;
  }

  async loadRecordFromSource(cdx) {
    const {wacz, start, length, path} = cdx.source;
    const offset = start;
    const unzip = true;

    const zipreader = this.getReaderForWACZ(wacz);

    const fileStream = await zipreader.loadFile("archive/" + path, {offset, length, unzip});
    const loader = new SingleRecordWARCLoader(fileStream);

    await this.updateEntriesIfNeeded(zipreader, wacz);

    return await loader.load();
  }

  async loadAllIndices(waczname) {
    if (!this.waczfiles[waczname]) {
      throw new Error("unknown waczfile: " + waczname);
    }

    if (this.waczfiles[waczname].indexType) {
      return {indexType: this.waczfiles[waczname].indexType, isNew: false};
    }

    const zipreader = this.getReaderForWACZ(waczname);

    const indexloaders = [];
    let indexType = INDEX_CDX;

    // load CDX and IDX
    for (const filename of Object.keys(this.waczfiles[waczname].entries)) {
      //const entryTotal = zipreader.getCompressedSize(filename);

      if (filename.endsWith(".cdx") || filename.endsWith(".cdxj")) {
        console.log(`Loading CDX for ${waczname}`);

        indexloaders.push(this.loadCDX(zipreader, filename, waczname));

      } else if (filename.endsWith(".idx")) {
        // For compressed indices
        console.log(`Loading IDX for ${waczname}`);

        indexloaders.push(this.loadIDX(zipreader, filename, waczname));

        indexType = INDEX_IDX;
      }
    }

    await Promise.all(indexloaders);

    this.waczfiles[waczname].indexType = indexType;
    await this.db.put("waczfiles", this.waczfiles[waczname]);

    return {indexType, isNew: true};
  }

  async loadCDX(zipreader, filename, waczname) {
    const reader = await zipreader.loadFile(filename);

    const loader = new CDXLoader(reader, null, null, {wacz: waczname});

    return loader.load(this);
  }

  async loadIDX(zipreader, filename, waczname) {
    const reader = await zipreader.loadFile(filename);

    let currOffset = 0;

    let batch = [];
    let defaultFilename = "";
    let useSurt = false;
    
    for await (const line of reader.iterLines()) {
      currOffset += line.length;

      // first line
      if (currOffset === line.length) {
        if (line.startsWith("!meta")) {
          const inx = line.indexOf(" {");
          if (inx < 0) {
            console.warn("Invalid Meta Line: " + line);
            continue;
          }

          const indexMetadata = JSON.parse(line.slice(inx));
          
          if (indexMetadata.filename) {
            defaultFilename = indexMetadata.filename;
          }
          if (indexMetadata.format !== "cdxj-gzip-1.0") {
            console.log(`Unknown CDXJ format "${indexMetadata.format}", archive may not parse correctly`);
          }
          continue;
        }
      }

      const inx = line.indexOf(" {");
      if (inx < 0) {
        console.log("Invalid Index Line: " + line);
        continue;
      }

      const prefix = line.slice(0, inx);
      let {offset, length, filename} = JSON.parse(line.slice(inx));

      useSurt = prefix.indexOf(")/") > 0;

      filename = filename || defaultFilename;

      const entry = {waczname, prefix, filename, offset, length, loaded: false};

      batch.push(entry);
    }

    const tx = this.db.transaction("ziplines", "readwrite");

    for (const entry of batch) {
      tx.store.put(entry);
    }

    try {
      await tx.done;
    } catch (e) {
      console.log("Error loading ziplines index: ", e);
    }

    if (this.waczfiles[waczname].useSurt) {
      // only store if defaults to true, false is default
      this.waczfiles[waczname].useSurt = useSurt;
      await this.db.put("waczfiles", this.waczfiles[waczname]);
    }
  }

  async loadCDXFromIDX(waczname, url/*, datetime*/) {
    //const timestamp = datetime ? getTS(new Date(datetime).toISOString()) : "";

    let prefix;
    let checkPrefix;

    const surt = this.waczfiles[waczname].useSurt ? getSurt(url) : url;

    prefix = surt + " 9999";
    checkPrefix = surt;

    const tx = this.db.transaction("ziplines", "readonly");

    const values = [];

    // and first match
    const key = IDBKeyRange.upperBound([waczname, prefix], false);

    for await (const cursor of tx.store.iterate(key, "prev")) {
      // restrict to specific waczname
      if (cursor.value.waczname !== waczname) {
        break;
      }

      // add to beginning as processing entries in reverse here
      values.unshift(cursor.value);
      if (!cursor.value.prefix.split(" ")[0].startsWith(checkPrefix)) {
        break;
      }
    }

    await tx.done;

    const cdxloaders = [];

    const zipreader = this.getReaderForWACZ(waczname);

    const waczSource = {
      wacz: waczname
    };

    for (const zipblock of values) {
      if (zipblock.loaded) {
        continue;
      }

      const filename = "indexes/" + zipblock.filename;
      const params = {offset: zipblock.offset, length: zipblock.length, unzip: true};

      const reader = await zipreader.loadFile(filename, params);

      cdxloaders.push(new CDXLoader(reader, null, null, waczSource).load(this));

      zipblock.loaded = true;
      await this.db.put("ziplines", zipblock);
    }

    await Promise.all(cdxloaders);

    await this.updateEntriesIfNeeded(zipreader, waczname);

    return cdxloaders.length > 0;
  }

  getReaderForWACZ(waczname) {
    return new ZipRangeReader(
      this.getBlockLoader(waczname),
      this.waczfiles[waczname].entries
    );
  }

  async updateEntriesIfNeeded(zipreader, waczname) {
    if (zipreader.entriesUpdated) {
      await this.db.put("waczfiles", this.waczfiles[waczname]);
      zipreader.entriesUpdated = false;
    }
  }

  getBlockLoader(filename) {
    return createLoader({
      url: filename
    });
  }

  async findPageAtUrl(url, ts) {
    const pages = await this.db.getAllFromIndex("pages", "url", url);
    let currPage = null;
    let minDiff = Number.MAX_SAFE_INTEGER;

    for (const page of pages) {
      const diff = Math.abs(page.ts - ts);
      if (diff < 1000) {
        return page;
      }
      if (diff < minDiff) {
        currPage = page;
        minDiff = diff;
      }
    }

    return currPage;
  }

  async getResource(request, prefix, event, {pageId} = {}) {
    await this.initing;

    const isNavigate = event.request.mode === "navigate";

    let waczname;

    if (pageId) {
      const page = await this.db.get("pages", pageId);
      if (page) {
        waczname = page.wacz;
      }
    }

    // if waczname, attempt to load from specific wacz
    const resp = await super.getResource(request, prefix, event, {pageId, waczname});
    if (resp) {
      return resp;
    }

    // if navigate, attempt to try to match by page
    if (isNavigate) {
      const ts = tsToDate(request.timestamp).getTime();
      const url = request.url;
      const page = await this.findPageAtUrl(url, ts);

      // redirect to page (if different from current)
      if (page && page.id !== pageId) {
        return Response.redirect(`${prefix}:${page.id}/${request.timestamp}mp_/${request.url}`);
      }
    }

    return resp;
  }

  async lookupUrl(url, datetime, opts = {}) {
    try {
      let result = await super.lookupUrl(url, datetime, opts);

      if (result && (!opts.noRevisits || result.mime !== "warc/revisit")) {
        return result;
      }

      const { waczname } = opts;

      if (waczname && waczname !== "local") {
        const {indexType, isNew} = await this.loadAllIndices(waczname);
        
        switch (indexType) {
        case INDEX_IDX:
          if (!await this.loadCDXFromIDX(waczname, url, datetime)) {
            // no new idx lines loaded
            return null;
          }
          break;

        case INDEX_CDX:
          if (!isNew) {
            return null;
          }
          break;

        default:
          return null;
        }

        result = await super.lookupUrl(url, datetime, opts);
      }

      return result;
    } catch (e) {
      console.warn(e);
      return null;
    }
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

    await db.syncWacz(files);

    return metadata;
  }

  loadFiles() {
    return this.json.resources.map((res) => {
      return new URL(res.path, this.baseUrl).href;
    });
  }
}
