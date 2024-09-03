import { BaseLoader } from "../blockloaders";
import { ArchiveLoader } from "../types";
import { MAX_FULL_DOWNLOAD_SIZE } from "../utils";

import { WARCLoader } from "../warcloader";

import { DEFAULT_WACZ, WACZFile } from "./waczfile";
import { WACZImporter } from "./waczimporter";
import { ZipRangeReader } from "./ziprangereader";

// ============================================================================
export class SingleWACZLoader implements ArchiveLoader {
  loader: BaseLoader;
  loadId: string | null = null;
  loadUrl: string;

  constructor(loader: BaseLoader, config: Record<string, any>, loadId = null) {
    this.loader = loader;
    this.loadId = loadId;
    this.loadUrl = config.loadUrl;
  }

  async load(db: any /*progressUpdate, fullTotalSize*/) {
    // if size less than MAX_FULL_DOWNLOAD_SIZE
    const loader = this.loader as any;
    if (
      db.fullConfig &&
      loader.arrayBuffer &&
      loader.arrayBuffer.byteLength <= MAX_FULL_DOWNLOAD_SIZE
    ) {
      if (!db.fullConfig.extra) {
        db.fullConfig.extra = {};
      }
      db.fullConfig.extra.arrayBuffer = loader.arrayBuffer;
    }

    const name = DEFAULT_WACZ;
    const path = this.loadUrl;
    return await db.addNewWACZ({ name, path, loader });
  }
}

// ==========================================================================
export class SingleWACZFullImportLoader implements ArchiveLoader {
  loader: BaseLoader;
  loadId: string | null = null;
  config: Record<string, any>;

  constructor(loader: BaseLoader, config: Record<string, any>, loadId = null) {
    this.config = config;
    this.loadId = loadId;

    this.loader = loader;
  }

  async load(
    db: any,
    progressUpdateCallback:
      | ((prog: number, x: any, offset: number, size: number) => void)
      | null = null,
    fullTotalSize = 0,
  ) {
    const file = new WACZFile({ loader: this.loader });
    await file.init();

    const zipreader = file.zipreader!;
    const importer = new WACZImporter(db, file);

    const metadata = await importer.load();

    let offsetTotal = 0;

    const progressUpdate = (
      percent: number,
      error: string,
      offset: number /*, total*/,
    ) => {
      offset += offsetTotal;
      if (progressUpdateCallback && fullTotalSize) {
        progressUpdateCallback(
          Math.round((offset * 100.0) / fullTotalSize),
          null,
          offset,
          fullTotalSize,
        );
      }
    };

    // load CDX and IDX
    for (const filename of file.iterContainedFiles()) {
      const entryTotal = zipreader.getCompressedSize(filename);
      if (filename.endsWith(".warc.gz") || filename.endsWith(".warc")) {
        await this.loadWARC(
          db,
          zipreader,
          filename,
          progressUpdate,
          entryTotal,
        );
      }

      offsetTotal += entryTotal;
    }

    return metadata || {};
  }

  async loadWARC(
    db: any,
    zipreader: ZipRangeReader,
    filename: string,
    progressUpdate: any,
    total: number,
  ) {
    const { reader } = await zipreader.loadFile(filename, { unzip: true });
    if (!reader) {
      throw new Error("no WARC found");
    }

    const loader = new WARCLoader(reader, null, filename);
    loader.detectPages = false;

    return await loader.load(db, progressUpdate, total);
  }
}

// ==========================================================================
export class JSONResponseMultiWACZLoader implements ArchiveLoader {
  response: Response;

  constructor(response: Response) {
    this.response = response;
  }

  async load(db: any) {
    return await db.loadFromJSON(this.response);
  }
}
