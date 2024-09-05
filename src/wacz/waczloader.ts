import { type BaseLoader } from "../blockloaders";
import { type ArchiveLoader } from "../types";
import { MAX_FULL_DOWNLOAD_SIZE } from "../utils";

import { WARCLoader } from "../warcloader";

import { DEFAULT_WACZ, WACZFile } from "./waczfile";
import { WACZImporter } from "./waczimporter";
import { type ZipRangeReader } from "./ziprangereader";

// ============================================================================
export class SingleWACZLoader implements ArchiveLoader {
  loader: BaseLoader;
  loadId: string | null = null;
  loadUrl: string;

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(loader: BaseLoader, config: Record<string, any>, loadId = null) {
    this.loader = loader;
    this.loadId = loadId;
    // @ts-expect-error [TODO] - TS4111 - Property 'loadUrl' comes from an index signature, so it must be accessed with ['loadUrl'].
    this.loadUrl = config.loadUrl;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async load(db: any /*progressUpdate, fullTotalSize*/) {
    // if size less than MAX_FULL_DOWNLOAD_SIZE
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await db.addNewWACZ({ name, path, loader });
  }
}

// ==========================================================================
export class SingleWACZFullImportLoader implements ArchiveLoader {
  loader: BaseLoader;
  loadId: string | null = null;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(loader: BaseLoader, config: Record<string, any>, loadId = null) {
    this.config = config;
    this.loadId = loadId;

    this.loader = loader;
  }

  async load(
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    progressUpdateCallback: // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | ((prog: number, x: any, offset: number, size: number) => void)
      | null = null,
    fullTotalSize = 0,
  ) {
    const file = new WACZFile({ loader: this.loader });
    await file.init();

    const zipreader = file.zipreader!;
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return metadata || {};
  }

  async loadWARC(
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    zipreader: ZipRangeReader,
    filename: string,
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progressUpdate: any,
    total: number,
  ) {
    const { reader } = await zipreader.loadFile(filename, { unzip: true });
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!reader) {
      throw new Error("no WARC found");
    }

    const loader = new WARCLoader(reader, null, filename);
    loader.detectPages = false;

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await loader.load(db, progressUpdate, total);
  }
}

// ==========================================================================
export class JSONResponseMultiWACZLoader implements ArchiveLoader {
  response: Response;

  constructor(response: Response) {
    this.response = response;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async load(db: any) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await db.loadFromJSON(this.response);
  }
}
