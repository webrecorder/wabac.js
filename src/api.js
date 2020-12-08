"use strict";

import { Path } from 'path-parser';

import { Downloader } from './downloader';
import { initIPFS, addPin, rmAllPins } from './ipfs';


// ===========================================================================
class APIRouter {
  constructor(paths) {
    this.routes = {};

    for (const [name, value] of Object.entries(paths)) {
      let route, method;

      if (value instanceof Array) {
        route = value[0];
        method = value[1] || "GET";
      } else {
        route = value;
        method = "GET";
      }

      this.routes[method] = this.routes[method] || {};
      this.routes[method][name] = new Path(route);
    }
  }

  match(url, method = "GET") {
    for (const [name, route] of Object.entries(this.routes[method] || [])) {
      const parts = url.split("?", 2);
      const matchUrl = parts[0];

      const res = route.test(matchUrl);
      if (res) {
        res._route = name;
        res._query = new URLSearchParams(parts.length === 2 ? parts[1] : "");
        return res;
      }
    }
  
    return {_route: null};
  }
}


// ===========================================================================
class API {
  constructor(collections) {
    this.router = new APIRouter({
      'index': 'index',
      'coll': ':coll',
      'urls': ':coll/urls',
      'createColl': ['create', 'POST'],
      'deleteColl': [':coll', 'DELETE'],
      'updateAuth': [':coll/updateAuth', 'POST'],
      'updateMetadata': [':coll/metadata', 'POST'],
      'curated': ':coll/curated/:list',
      'pages': ':coll/pages',
      'textIndex': ':coll/textIndex',
      'deletePage': [':coll/page/:page', 'DELETE'],
      'downloadPages': ':coll/dl',
      'ipfsPin': [':coll/ipfs/pin', 'POST'],
      'ipfsUnpin': [':coll/ipfs/unpin', 'POST']
    });

    this.collections = collections;
  }

  async apiResponse(url, method, request) {
    const response = await this.handleApi(url, method, request);
    if (response instanceof Response) {
      return response;
    }
    const status = response.error ? 404 : 200;
    return this.makeResponse(response, status);
  }

  getCollData(coll) {
    const metadata = coll.config.metadata ? coll.config.metadata : {};

    const res = {
      "title": metadata.title || "",
      "desc": metadata.desc || "",
      "size": metadata.size || 0,
      "filename": coll.config.sourceName,
      "sourceUrl": coll.config.sourceUrl,
      "id": coll.name,
      "ctime": coll.config.ctime,
      "onDemand": coll.config.onDemand,
    };

    if (metadata.ipfsPins) {
      res.ipfsPins = metadata.ipfsPins;
    }

    return res;
  }

  async handleApi(url, method, request) {
    let params = this.router.match(url, method);
    let coll;
    let total;
    let count;
    let urls;
    let requestJSON;

    switch (params._route) {
      case "index":
        return await this.listAll();

      case "createColl":
        requestJSON = await request.json();
        coll = await this.collections.initNewColl(requestJSON.metadata || {}, requestJSON.extraConfig || {});
        return this.getCollData(coll);

      case "coll":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }
        const data = this.getCollData(coll);

        if (params._query.get("all") === "1") {
          data.pages = await coll.store.getAllPages();
          if (coll.store.db) {
            data.lists = await coll.store.db.getAll("pageLists");
            data.curatedPages = await coll.store.db.getAll("curatedPages");
          } else {
            data.lists = [];
            data.curatedPages = [];
          }

        } else {
          data.numLists = await coll.store.db.count("pageLists");
          data.numPages = await coll.store.db.count("pages");
        }

        if (coll.config.metadata.ipfsPins) {
          data.ipfsPins = coll.config.metadata.ipfsPins;
        }

        return data;

      case "deleteColl":
        const keepFileHandle = params._query.get("reload") === "1";

        if (!await this.collections.deleteColl(params.coll, keepFileHandle)) {
          return {error: "collection_not_found"};
        }
        return await this.listAll();

      case "updateAuth":
        requestJSON = await request.json();
        return {"success": await this.collections.updateAuth(params.coll, requestJSON.headers)};

      case "updateMetadata":
        requestJSON = await request.json();
        const metadata = await this.collections.updateMetadata(params.coll, requestJSON);
        return {metadata};

      case "urls":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }
        const url = params._query.get("url");
        count = Number(params._query.get("count") || 100);
        const mime = params._query.get("mime");
        const prefix = (params._query.get("prefix") === "1");

        const fromUrl = params._query.get("fromUrl");
        const fromTs = params._query.get("fromTs");
        const fromMime = params._query.get("fromMime");
        const fromStatus = Number(params._query.get("fromStatus") || 0);

        if (!coll.store.resourcesByMime) {
          return {urls: []}
        }

        if (url) {
          urls = await coll.store.resourcesByUrlAndMime(url, mime, count, prefix, fromUrl, fromTs);
        } else {
          urls = await coll.store.resourcesByMime(mime, count, fromMime, fromUrl, fromStatus);
        }

        return {urls};

      case "pages":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }
        const pages = await coll.store.getAllPages();
        return {pages};

      case "textIndex":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }
        if (coll.store.getTextIndex) {
          return await coll.store.getTextIndex();
        } else {
          return {};
        }

      case "curated":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }
        const list = Number(params.list);
        const curated = await coll.store.db.getAllFromIndex("curatedPages", "listPages", 
        IDBKeyRange.bound([list], [list + 1]));
        return {curated};

      case "deletePage":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }
        const {pageSize, deleteSize} = coll.store.deletePage(params.page);

        this.collections.updateSize(params.coll, pageSize, deleteSize);

        return {pageSize, deleteSize};

      case "downloadPages":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }

        const pageQ = params._query.get("pages");
        const pageList = pageQ === "all" ? null : pageQ.split(",");

        const format = params._query.get("format") || "wacz";
        let filename = params._query.get("filename");

        return this.getDownloadResponse({coll, format, filename, pageList});

      case "ipfsPin":
        return await this.ipfsPinUnpin(params.coll, true);

      case "ipfsUnpin":
        return await this.ipfsPinUnpin(params.coll, false);

      default:
        return {"error": "not_found"};
    }
  }

  getDownloadResponse({coll, format = "wacz", filename = null, pageList = null}) {
    const dl = new Downloader(coll.store, pageList, coll.name, coll.config.metadata);

    // determine filename from title, if it exists
    if (!filename && coll.config.metadata.title) {
      filename = coll.config.metadata.title.toLowerCase().replace(/\s/g, "-");
    }
    if (!filename) {
      filename = "webarchive";
    }

    let resp = null;

    if (format === "wacz") {
      return dl.downloadWACZ(filename);
    } else if (format === "warc") {
      return dl.downloadWARC(filename);
    } else {
      return {"error": "invalid 'format': must be wacz or warc"};
    }
  }

  async ipfsPinUnpin(collId, isPin) {
    const coll = await this.collections.getColl(collId);
    if (!coll) {
      return {error: "collection_not_found"};
    }

    const ipfs = await initIPFS();

    if (isPin) {
      const dlResponse = await this.getDownloadResponse({coll});

      const resp = await ipfs.add({
        path: dlResponse.filename,
        content: dlResponse.body
      }, {wrapWithDirectory: true});

      const hash = resp.cid.toString();

      const ipfsUrl = `ipfs://${hash}/${dlResponse.filename}`;

      coll.config.metadata.ipfsPins = addPin(coll.config.metadata.ipfsPins, hash, ipfsUrl, resp.size);

      console.log("ipfs hash added " + ipfsUrl);

      await this.collections.updateMetadata(coll.name, coll.config.metadata);

      return {"ipfsURL": ipfsUrl};

    } else {
      if (coll.config.metadata.ipfsPins) {
        coll.config.metadata.ipfsPins = await rmAllPins(coll.config.metadata.ipfsPins);

        await this.collections.updateMetadata(coll.name, coll.config.metadata);
      }

      return {"removed": true};
    }
  }

  async listAll() {
    const response = await this.collections.listAll();
    const collections = [];

    response.forEach((coll) => {
      if (coll.type === "live" || coll.type === "remoteproxy") {
        return;
      }
      collections.push(this.getCollData(coll));
    });

    return {"colls": collections};
  }

  makeResponse(response, status = 200) {
    return new Response(JSON.stringify(response), {status, headers: {"Content-Type": "application/json"}});
  }
}

export { API };