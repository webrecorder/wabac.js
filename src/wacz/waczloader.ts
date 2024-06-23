import { BaseLoader } from "../blockloaders.js";
import { MAX_FULL_DOWNLOAD_SIZE } from "../utils.js";

import { WARCLoader } from "../warcloader.js";

import { DEFAULT_WACZ, WACZFile } from "./waczfile.js";
import { WACZImporter } from "./waczimporter.js";
import { ZipBlockLoader } from "./ziprangereader.js";


// ============================================================================
export class SingleWACZLoader
{
  loader: BaseLoader;
  loadId: string | null = null;
  loadUrl: string;

  constructor(loader, config, loadId = null) {
    this.loader = loader;
    this.loadId = loadId;
    this.loadUrl = config.loadUrl;
  }

  async load(db, /*progressUpdate, fullTotalSize*/) {
    // if size less than MAX_FULL_DOWNLOAD_SIZE
    const loader = this.loader as any;
    if (db.fullConfig && loader.arrayBuffer &&
      loader.arrayBuffer.byteLength <= MAX_FULL_DOWNLOAD_SIZE) {
      if (!db.fullConfig.extra) {
        db.fullConfig.extra = {};
      }
      db.fullConfig.extra.arrayBuffer = loader.arrayBuffer;
    }

    const name = DEFAULT_WACZ;
    const path = this.loadUrl;
    return await db.addNewWACZ({name, path, loader});
  }
}

// ==========================================================================
export class SingleWACZFullImportLoader
{
  loader: BaseLoader;
  loadId: string | null = null;
  config: any;

  constructor(loader, config, loadId = null) {
    this.config = config;
    this.loadId = loadId;

    this.loader = loader;
  }

  async load(db, progressUpdateCallback : ((prog: number, x: any, offset: number, size: number) => void) | null = null, fullTotalSize = 0) {

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
      const entryTotal = zipreader?.getCompressedSize(filename);
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
export class JSONResponseMultiWACZLoader
{
  response: Response;
  
  constructor(response) {
    this.response = response;
  }

  async load(db)  {
    return await db.loadFromJSON(this.response);
  }
}
