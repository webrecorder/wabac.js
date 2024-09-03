import { ArchiveDB } from "./archivedb";
import { RemoteSourceArchiveDB, RemotePrefixArchiveDB } from "./remotearchivedb";
//import { WACZRemoteArchiveDB } from "./waczarchive";

import { HARLoader } from "./harloader";
//import { WBNLoader } from "./wbnloader";
import { WARCLoader } from "./warcloader";
import { CDXLoader, CDXFromWARCLoader } from "./cdxloader";

import { SingleWACZLoader, SingleWACZFullImportLoader, JSONResponseMultiWACZLoader } from "./wacz/waczloader";
import { MultiWACZ } from "./wacz/multiwacz";

import { BaseLoader, createLoader } from "./blockloaders";

import { RemoteWARCProxy } from "./remotewarcproxy";
import { LiveProxy } from "./liveproxy";

import { IDBPDatabase, deleteDB, openDB } from "idb/with-async-ittr";
import { Canceled, MAX_FULL_DOWNLOAD_SIZE, randomId, AuthNeededError } from "./utils";
import { detectFileType, getKnownFileExtension } from "./detectfiletype";
import { ArchiveLoader, DBStore } from "./types";

if (!globalThis.self) {
  (globalThis as any).self = globalThis;
}

const interruptLoads : Record<string, () => void> = {};
(self as any).interruptLoads = interruptLoads;


export type LoadColl = {
  name?: string;
  type: string;
  config: Record<string, any>;
  store?: DBStore;
}

export type CollConfig = {
  root: string;
  dbname?: string;

  sourceUrl: string;
  extraConfig?: Record<string, any>;

  topTemplateUrl?: string;
  metadata: Record<string, any>;

  type: string;
}


// ===========================================================================
export class CollectionLoader
{
  root: string | null = null;
  colldb: IDBPDatabase | null = null;
  checkIpfs = true;
  _init_db: Promise<void>;

  _fileHandles: Record<string, FileSystemFileHandle> | null = null;

  constructor() {
    this._init_db = this._initDB();
  }

  async _initDB() {
    this.colldb = await openDB("collDB", 1, {
      upgrade: (db/*, oldV, newV, tx*/) => {
        const collstore = db.createObjectStore("colls", {keyPath: "name"});

        collstore.createIndex("type", "type");
      }
    });
  }

  async loadAll(dbColls: string) {
    await this._init_db;

    if (dbColls) {
      for (const extraColl of dbColls.split(",")) {
        const parts = extraColl.split(":");
        if (parts.length === 2) {
          const config = {dbname: parts[1], sourceName: parts[1], decode: false};
          const collData = {name: parts[0], type: "archive", config};
          console.log("Adding Coll: " + JSON.stringify(collData));
          await this.colldb!.put("colls", collData);
        }
      }
    }

    try {
      const allColls = await this.listAll();

      const promises = allColls.map((data) => this._initColl(data));
  
      await Promise.all(promises);
    } catch (e: any) {
      console.warn(e.toString());
    }

    return true;
  }

  async listAll() {
    await this._init_db;
    return await this.colldb!.getAll("colls");
  }

  async loadColl(name: string) {
    await this._init_db;
    const data = await this.colldb!.get("colls", name);
    if (!data) {
      return null;
    }

    return await this._initColl(data);
  }

  async reload(name: string) {
    return this.loadColl(name);
  }

  async deleteColl(name: string) {
    await this._init_db;
    const data = await this.colldb!.get("colls", name);
    if (!data) {
      return false;
    }

    if (data.config.dbname) {
      try {
        await deleteDB(data.config.dbname, {
          blocked(_, e) {
            console.log(`Unable to delete ${data.config.dbname}, blocked: ${e}`);
          }
        });
      } catch(e) {
        console.warn(e);
        return false;
      }
    }

    await this.colldb!.delete("colls", name);

    return true;
  }

  async updateAuth(name: string, newHeaders: Record<string, string>) {
    await this._init_db;
    const data = await this.colldb!.get("colls", name);
    if (!data) {
      return false;
    }
    data.config.headers = newHeaders;
    await this.colldb!.put("colls", data);
    return true;
  }

  async updateMetadata(name: string, newMetadata: Record<string, string>) {
    await this._init_db;
    const data = await this.colldb!.get("colls", name);
    if (!data) {
      return false;
    }
    data.config.metadata = {...data.config.metadata, ...newMetadata};

    await this.colldb!.put("colls", data);
    return data.config.metadata;
  }

  async updateSize(name: string, fullSize: number, dedupSize: number, decodeUpdate?: boolean) {
    await this._init_db;
    const data = await this.colldb!.get("colls", name);
    if (!data) {
      return false;
    }

    const metadata = data.config.metadata;
    metadata.fullSize = (metadata.fullSize || 0) + fullSize;
    metadata.size = (metadata.size || 0) + dedupSize;
    metadata.mtime = new Date().getTime();

    // if set, also update decode (a little hacky)
    if (decodeUpdate !== undefined) {
      data.config.decode = decodeUpdate;
    }
    await this.colldb!.put("colls", data);
    return metadata;
  }

  async initNewColl(metadata: Record<string, any>, extraConfig = {}, type = "archive") {
    await this._init_db;
    const id = randomId();
    const dbname = "db:" + id;
    const sourceUrl = "local://" + id;
    const decode = false;
    const ctime = new Date().getTime();

    const data = {
      name: id,
      type,
      config: {
        dbname,
        ctime,
        decode,
        metadata,
        sourceUrl,
        extraConfig,
      }
    };

    const coll = await this._initColl(data);
    await this.colldb!.put("colls", data);
    return coll;
  }

  async _initColl(data: LoadColl) : Promise<any> {
    const store = await this._initStore(data.type || "", data.config);

    const name = data.name;
    const config = data.config;

    if (data.config.root && !this.root) {
      this.root = name || null;
    }

    return this._createCollection({name, store, config});
  }

  async _initStore(type: string, config: Record<string, any>) {
    let sourceLoader : BaseLoader;
    let store : DBStore | null = null;

    switch (type) {
    case "archive":
      store = new ArchiveDB(config.dbname);
      break;

    case "remotesource":
      sourceLoader = await createLoader({
        url: config.loadUrl,
        headers: config.headers,
        size: config.size,
        extra: config.extra
      });
      store = new RemoteSourceArchiveDB(config.dbname, sourceLoader, config.noCache);
      break;

    case "remoteprefix":
      store = new RemotePrefixArchiveDB(config.dbname, config.remotePrefix, config.headers, config.noCache);
      break;        

    case "wacz":
    case "remotezip":
    case "multiwacz":
      sourceLoader = await createLoader({
        url: config.loadUrl || config.sourceUrl,
        headers: config.headers,
        extra: config.extra
      });
      store = new MultiWACZ(config, sourceLoader, type === "multiwacz" ? "json" : "wacz");
      break;

    case "remotewarcproxy":
      store = new RemoteWARCProxy(config);
      break;

    case "live":
      store = new LiveProxy(config.extraConfig);
      break;
    }

    if (!store) {
      console.log("no store found: " + type);
      return null;
    }

    if ((store as ArchiveDB).initing) {
      await (store as ArchiveDB).initing;
    }

    return store;
  }

  _createCollection(opts: Record<string, any>) {
    return opts;
  }
}

// ===========================================================================
export class WorkerLoader extends CollectionLoader
{
  constructor(worker: WorkerGlobalScope) {
    super();
    this.registerListener(worker);
  }

  async hasCollection(name: string) {
    await this._init_db;

    return await this.colldb!.getKey("colls", name) != null;
  }

  registerListener(worker: WorkerGlobalScope) {
    worker.addEventListener("message", (event: any) => {
      if ((event as any).waitUntil) {
        (event as any).waitUntil(this._handleMessage(event as MessageEvent));
      } else {
        this._handleMessage(event);
      }
    });
  }

  async _handleMessage(event: MessageEvent) {
    await this._init_db;

    const client = event.source || self;

    switch (event.data.msg_type) {
    case "addColl":
    {
      const name = event.data.name; 

      const progressUpdate = (percent?: number, error?: string, currentSize?: number | null, 
                              totalSize?: number | null, fileHandle = null, extraMsg = null) => {
        client.postMessage({
          "msg_type": "collProgress",
          name,
          percent,
          error,
          currentSize,
          totalSize,
          fileHandle,
          extraMsg
        });
      };

      let res;

      try {
        res = await this.colldb!.get("colls", name);
        if (res) {
          if (!event.data.skipExisting) {
            await this.deleteColl(name);
            res = await this.addCollection(event.data, progressUpdate);
          }
        } else {
          res = await this.addCollection(event.data, progressUpdate);
        }
  
        if (!res) {
          if (event.data.name) {
            try {
              await deleteDB("db:" + event.data.name, {
                blocked(_, e) {
                  console.log(`Load failed and unable to delete ${event.data.name}: ${e}`);
                }
              });
            } catch (e) {
              console.warn(e);
            }
          }
          return;
        }

      } catch (e: any) {
        if (e instanceof AuthNeededError) {
          console.warn(e);
          progressUpdate(0, "permission_needed", null, null, e.info && e.info.fileHandle);
          return;
        } else if (e.name === "ConstraintError") {
          console.log("already being added, just continue...");
          res = await this.colldb!.get("colls", name);
        } else {
          console.warn(e);
          progressUpdate(0, "An unexpected error occured: " + e.toString(), null, null);
          return;
        }
      }

      client.postMessage({
        msg_type: "collAdded",
        name,
        sourceUrl: res.config.sourceUrl
      });

      //this.doListAll(client);
      break;
    }

    case "cancelLoad":
    {
      const name = event.data.name;

      const p = new Promise<void>((resolve) => interruptLoads[name] = resolve);

      await p;

      await this.deleteColl(name);

      delete interruptLoads[name];

      break;
    }

    case "removeColl":
    {
      const name = event.data.name;

      if (await this.hasCollection(name)) {
        await this.deleteColl(name);
        this.doListAll(client);
      }
      break;
    }

    case "listAll":
      this.doListAll(client);
      break;

    case "reload":
      this.reload(event.data.name);
      break;
    }
  }

  async doListAll(client: (WorkerGlobalScope & typeof globalThis) | MessageEventSource) {
    const msgData : Record<string, any>[] = [];
    const allColls = await this.listAll();

    for (const coll of allColls) {

      //const pageList = await coll.store.getAllPages();
  
      msgData.push({
        "name": coll.name,
        "prefix": coll.name,
        "pageList": [],
        "sourceName": coll.config.sourceName
      });
    }
    client.postMessage({ "msg_type": "listAll", "colls": msgData });
  }
  
  async addCollection(data: Record<string, any>, progressUpdate: any) : Promise<LoadColl | false> {
    let name = data.name;

    let type : string = "";
    let config : Record<string, any> = {root: data.root || false};
    let generalDB : DBStore | null = null;

    let updateExistingConfig : Record<string, any> | null = null;

    const file = data.file;

    if (!file || !file.sourceUrl) {
      progressUpdate(0, "Invalid Load Request");
      return false;
    }

    config.dbname = "db:" + name;

    if (file.sourceUrl.startsWith("proxy:")) {
      config.sourceUrl = file.sourceUrl.slice("proxy:".length);
      config.extraConfig = data.extraConfig;
      if (!config.extraConfig.prefix) {
        config.extraConfig.prefix = config.sourceUrl;
      }
      config.topTemplateUrl = data.topTemplateUrl;
      config.metadata = {};
      type = data.type || config.extraConfig.type || "remotewarcproxy";

      generalDB = await this._initStore(type, config);

    } else {
      let loader : ArchiveLoader | null = null;
      let db : ArchiveDB | null = null;

      if (file.newFullImport) {
        name = randomId();
        file.loadUrl = file.loadUrl || file.sourceUrl;
        file.name = file.name || file.sourceUrl;
        file.sourceUrl = "local://" + name;
      }

      type = "archive";

      if (file.newFullImport && file.importCollId) {
        const existing = await this.colldb!.get("colls", file.importCollId);
        if (!existing || existing.type !== "archive") {
          progressUpdate(0, "Invalid Existing Collection: " + file.importCollId);
          return false;
        }
        config.dbname = existing.config.dbname;
        updateExistingConfig = existing.config;
        if (updateExistingConfig) {
          updateExistingConfig.decode = true;
        }
      }

      let loadUrl = file.loadUrl || file.sourceUrl;

      if (!loadUrl.match(/[\w]+:\/\//)) {
        loadUrl = new URL(loadUrl, self.location.href).href;
      }

      config.decode = true;
      config.onDemand = false;
      config.loadUrl = loadUrl;
      config.sourceUrl = file.sourceUrl;

      config.sourceName = file.name || file.sourceUrl;

      // parse to strip out query, keep hash/fragment (if any)
      try {
        if (config.sourceName.match(/https?:\/\//)) {
          const sourceUrl = new URL(config.sourceName);
          config.sourceName = sourceUrl.pathname + sourceUrl.hash;
        }
      } catch (e) {
        // ignore, keep sourceName as is
      }
      config.sourceName = config.sourceName.slice(config.sourceName.lastIndexOf("/") + 1);

      config.size = typeof(file.size) === "number" ? file.size : null;
      config.extra = file.extra;

      if (config.loadUrl.startsWith("file://") && !file.blob && !config.extra) {
        if (this._fileHandles && this._fileHandles[config.sourceUrl]) {
          config.extra = {fileHandle: this._fileHandles[config.sourceUrl]};
        } else {
          progressUpdate(0, "missing_local_file");
          return false;
        }
      }

      config.extraConfig = data.extraConfig;
      config.headers = file.headers || (config.extraConfig && config.extraConfig.headers);
      config.noCache = file.noCache;

      let sourceLoader = await createLoader({
        url: loadUrl,
        headers: config.headers,
        size: file.size,
        extra: config.extra,
        blob: file.blob
      });

      if (file.loadEager) {
        const { response } = await sourceLoader.doInitialFetch(false, true);
        const arrayBuffer = new Uint8Array(await response.arrayBuffer());
        const extra = {arrayBuffer};

        //config.extra = extra;
        file.newFullImport = true;

        sourceLoader = await createLoader({
          url: loadUrl,
          headers: config.headers,
          size: file.size,
          extra,
        });
      }

      let sourceExt : string | undefined = getKnownFileExtension(config.sourceName);

      let { abort, response } = await sourceLoader.doInitialFetch(sourceExt === ".wacz", false);

      if (!sourceExt) {
        sourceExt = await detectFileType(await response.clone());
      }

      const stream = response.body;

      config.onDemand = sourceLoader.canLoadOnDemand && !file.newFullImport;

      if (!sourceLoader.isValid || !stream) {
        const text = (sourceLoader.length && sourceLoader.length <= 1000) ? await response.text() : "";
        progressUpdate(0, `\
Sorry, this URL could not be loaded.
Make sure this is a valid URL and you have access to this file.
Status: ${response.status} ${response.statusText}
Error Details:
${text}`);
        if (abort) {
          abort.abort();
        }
        return false;
      }

      if (!sourceLoader.length) {
        progressUpdate(0, `\
Sorry, this URL could not be loaded because the size of the file is not accessible.
Make sure this is a valid URL and you have access to this file.`);
        if (abort) {
          abort.abort();
        }
        return false;
      }

      const contentLength = sourceLoader.length;

      if (sourceExt === ".wacz") {
        if (config.onDemand) {
          loader = new SingleWACZLoader(sourceLoader, config, name);
          db = new MultiWACZ(config, sourceLoader, "wacz");
          type = "wacz";

        // can load on demand, but want a full import
        } else if (sourceLoader.canLoadOnDemand && file.newFullImport) {
          loader = new SingleWACZFullImportLoader(sourceLoader, config, name);
          //use default db
          db = null;
          delete config.extra;

        } else {
          progressUpdate(0, "Sorry, can't load this WACZ file due to lack of range request support on the server");
          if (abort) {
            abort.abort();
          }
          return false;
        }

      } else if (sourceExt === ".warc" || sourceExt === ".warc.gz") {
        if (!config.noCache && (contentLength < MAX_FULL_DOWNLOAD_SIZE || !config.onDemand)) {
          loader = new WARCLoader(stream, abort, name);
        } else {
          loader = new CDXFromWARCLoader(stream, abort, name);
          type = "remotesource";
          db = new RemoteSourceArchiveDB(config.dbname, sourceLoader, config.noCache);
        }

      } else if (sourceExt === ".cdx" || sourceExt === ".cdxj") {
        config.remotePrefix = data.remotePrefix || loadUrl.slice(0, loadUrl.lastIndexOf("/") + 1);
        loader = new CDXLoader(stream, abort, name);
        type = "remoteprefix";
        db = new RemotePrefixArchiveDB(config.dbname, config.remotePrefix, config.headers, config.noCache);
      
        // } else if (sourceExt === ".wbn") {
        //   //todo: fix
        //   loader = new WBNLoader(await response.arrayBuffer());
        //   config.decode = false;

      } else if (sourceExt === ".har") {
        loader = new HARLoader(await response.json());
        config.decode = false;
      } else if (sourceExt === ".json") {
        db = new MultiWACZ(config, sourceLoader, "json");
        loader = new JSONResponseMultiWACZLoader(response);
        type = "multiwacz";
      }

      if (!loader) {
        progressUpdate(0, `The ${config.sourceName} is not a known archive format that could be loaded.`);
        if (abort) {
          abort.abort();
        }
        return false;
      }

      if (!db) {
        db = new ArchiveDB(config.dbname);
      }
      await db.initing;

      try {
        config.metadata = await loader.load(db, progressUpdate, contentLength);
      } catch (e: any) {
        if (!(e instanceof Canceled)) {
          progressUpdate(0, `Unexpected Loading Error: ${e.toString()}`);
          console.warn(e);
        }
        return false;
      }

      if (updateExistingConfig) {
        await this.updateSize(file.importCollId, contentLength, contentLength, updateExistingConfig.decode);
        return {config: updateExistingConfig, type: ""};
      }

      if (!config.metadata.size) {
        config.metadata.size = contentLength;
      }

      if (!config.metadata.title) {
        config.metadata.title = config.sourceName;
      }

      generalDB = db;
    }

    config.ctime = new Date().getTime();

    if (this._fileHandles && config.extra && config.extra.fileHandle) {
      delete this._fileHandles[config.sourceUrl];
    }

    const collData : Record<string, any> = {name, type, config};
    await this.colldb!.add("colls", collData);
    collData.store = generalDB;
    return collData as LoadColl;
  }
}
