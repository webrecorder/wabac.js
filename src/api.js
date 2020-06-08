"use strict";

import { Path } from 'path-parser';

import { Downloader} from './downloader';


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
      'deleteColl': [':coll', 'DELETE'],
      'updateAuth': [':coll/updateAuth', 'POST'],
      'curated': ':coll/curated/:list',
      'pages': ':coll/pages',
      'deletePage': [':coll/page/:page', 'DELETE'],
      'downloadPages': ':coll/dl'
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

    return {
      "title": metadata.title || "",
      "desc": metadata.desc || "",
      "size": metadata.size || 0,
      "filename": coll.config.sourceName,
      "sourceUrl": coll.config.sourceUrl,
      "id": coll.name,
      "ctime": coll.config.ctime,
      "onDemand": coll.config.onDemand
    }
  }

  async handleApi(url, method, request) {
    let params = this.router.match(url, method);
    let coll;
    let total;
    let count;
    let urls;

    switch (params._route) {
      case "index":
        return await this.listAll();

      case "coll":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }
        const data = this.getCollData(coll);

        if (params._query.get("all") === "1") {
          data.pages = await coll.store.getAllPages();
          data.lists = await coll.store.db.getAll("pageLists");
          data.curatedPages = await coll.store.db.getAll("curatedPages");
        } else {
          data.numLists = await coll.store.db.count("pageLists");
          data.numPages = await coll.store.db.count("pages");
        }

        return data;

      case "deleteColl":
        if (!await this.collections.deleteColl(params.coll)) {
          return {error: "collection_not_found"};
        }
        return await this.listAll();

      case "updateAuth":
        const requestJSON = await request.json();
        return {"success": await this.collections.updateAuth(params.coll, requestJSON.headers)};

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

        if (url) {
          urls = await coll.store.resourcesByUrlAndMime(url, mime, count, prefix, fromUrl, fromTs);
        } else {
          urls = await coll.store.resourcesByMime(mime, count, fromMime, fromUrl);
        }

        return {urls};

      case "pages":
        coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return {error: "collection_not_found"};
        }
        const pages = await coll.store.getAllPages();
        return {pages};

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

        const dl = new Downloader(coll.store, pageList, params.coll, coll.config.metadata);

        const format = params._query.get("format") || "wacz";
        const filename = params._query.get("filename") || "webarchive";

        if (format === "wacz") {
          return dl.downloadWACZ(filename);
        } else if (format === "warc") {
          return dl.downloadWARC(filename);
        } else {
          return {"error": "invalid 'format': must be wacz or warc"};
        }

      default:
        return {"error": "not_found"};
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