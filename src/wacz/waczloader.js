import { MAX_FULL_DOWNLOAD_SIZE } from "../utils.js";

import { WARCLoader } from "../warcloader.js";

import { WACZFile } from "./waczfile.js";
import { WACZImporter } from "./waczimporter.js";


// ============================================================================
export class SingleWACZLoader
{
  constructor(loader, config, loadId = null) {
    this.loader = loader;
    this.loadId = loadId;
    this.loadUrl = config.loadUrl;
  }

  async load(db, /*progressUpdate, fullTotalSize*/) {
    // if size less than MAX_FULL_DOWNLOAD_SIZE
    if (db.fullConfig && this.loader.arrayBuffer &&
      this.loader.arrayBuffer.byteLength <= MAX_FULL_DOWNLOAD_SIZE) {
      if (!db.fullConfig.extra) {
        db.fullConfig.extra = {};
      }
      db.fullConfig.extra.arrayBuffer = this.loader.arrayBuffer;
    }

    return await db.addNewWACZ({url: this.loadUrl});
  }
}

// ==========================================================================
export class SingleWACZFullImportLoader
{
  constructor(loader, config, loadId = null) {
    this.config = config;
    this.loadId = loadId;

    this.loader = loader;
  }

  async load(db, progressUpdateCallback = null, fullTotalSize = 0) {

    const file = new WACZFile({loader: this.loader});
    await file.init();
    
    const zipreader = file.zipreader;
    const importer = new WACZImporter(db, file);

    const metadata = await importer.load();

    let offsetTotal = 0;

    const progressUpdate = (percent, error, offset/*, total*/) => {
      offset += offsetTotal;
      if (progressUpdateCallback && fullTotalSize) {
        progressUpdateCallback(Math.round(offset * 100.0 / fullTotalSize), null, offset, fullTotalSize);
      }
    };

    // load CDX and IDX
    for (const filename of file.iterContainedFiles()) {
      const entryTotal = zipreader.getCompressedSize(filename);
      if (filename.endsWith(".warc.gz") || filename.endsWith(".warc")) {
        await this.loadWARC(db, zipreader, filename, progressUpdate, entryTotal);
      }

      offsetTotal += entryTotal;
    }

    return metadata || {};
  }

  async loadWARC(db, zipreader, filename, progressUpdate, total) {
    const {reader} = await zipreader.loadFile(filename, {unzip: true});

    const loader = new WARCLoader(reader, null, filename);
    loader.detectPages = false;

    return await loader.load(db, progressUpdate, total);
  }
}

// ==========================================================================
export class JSONMultiWACZLoader
{
  constructor(json) {
    this.json = json;
  }

  async load(db)  {
    await db.loadWACZFiles(this.json);

    return {
      title: this.json.title,
      desc: this.json.description
    };
  }
}
