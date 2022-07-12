"use strict";

import { Path } from "path-parser";
import { getCollData } from "./utils";

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
    this.router = new APIRouter(this.routes);

    this.collections = collections;
  }

  get routes() {
    return {
      "index": "coll-index",
      "coll": "c/:coll",
      "urls": "c/:coll/urls",
      "createColl": ["c/create", "POST"],
      "deleteColl": ["c/:coll", "DELETE"],
      "updateAuth": ["c/:coll/updateAuth", "POST"],
      "updateMetadata": ["c/:coll/metadata", "POST"],
      "curated": "c/:coll/curated/:list",
      "pages": "c/:coll/pages",
      "textIndex": "c/:coll/textIndex",
      "deletePage": ["c/:coll/page/:page", "DELETE"],
    };
  }

  async apiResponse(url, request, event) {
    const params = this.router.match(url, request.method);
    const response = await this.handleApi(request, params, event);
    if (response instanceof Response) {
      return response;
    }
    const status = response.error ? 404 : 200;
    return this.makeResponse(response, status);
  }

  async handleApi(request, params/*, event*/) {
    switch (params._route) {
    case "index":
      return await this.listAll(params._query.get("filter"));

    case "createColl": {
      const requestJSON = await request.json();
      const coll = await this.collections.initNewColl(requestJSON.metadata || {}, requestJSON.extraConfig || {});
      return getCollData(coll);
    }

    case "coll": {
      const coll = await this.collections.getColl(params.coll);
      if (!coll) {
        return {error: "collection_not_found"};
      }
      const data = getCollData(coll);

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
    }

    case "deleteColl": {
      const keepFileHandle = params._query.get("reload") === "1";

      if (!await this.collections.deleteColl(params.coll, keepFileHandle)) {
        return {error: "collection_not_found"};
      }
      return await this.listAll();
    }

    case "updateAuth": {
      const requestJSON = await request.json();
      return {"success": await this.collections.updateAuth(params.coll, requestJSON.headers)};
    }

    case "updateMetadata": {
      const requestJSON = await request.json();
      const metadata = await this.collections.updateMetadata(params.coll, requestJSON);
      return {metadata};
    }

    case "urls": {
      const coll = await this.collections.getColl(params.coll);
      if (!coll) {
        return {error: "collection_not_found"};
      }
      const url = params._query.get("url");
      const count = Number(params._query.get("count") || 100);
      const mime = params._query.get("mime");
      const prefix = (params._query.get("prefix") === "1");

      const fromUrl = params._query.get("fromUrl");
      const fromTs = params._query.get("fromTs");
      const fromMime = params._query.get("fromMime");
      const fromStatus = Number(params._query.get("fromStatus") || 0);

      if (!coll.store.resourcesByMime) {
        return {urls: []};
      }

      let urls;

      if (url) {
        urls = await coll.store.resourcesByUrlAndMime(url, mime, count, prefix, fromUrl, fromTs);
      } else {
        urls = await coll.store.resourcesByMime(mime, count, fromMime, fromUrl, fromStatus);
      }

      urls = urls || [];

      return {urls};
    }

    case "pages": {
      const coll = await this.collections.getColl(params.coll);
      if (!coll) {
        return {error: "collection_not_found"};
      }
      const pages = await coll.store.getAllPages();
      return {pages};
    }

    case "textIndex": {
      const coll = await this.collections.getColl(params.coll);
      if (!coll) {
        return {error: "collection_not_found"};
      }
      if (coll.store.getTextIndex) {
        return await coll.store.getTextIndex();
      } else {
        return {};
      }
    }

    case "curated": {
      const coll = await this.collections.getColl(params.coll);
      if (!coll) {
        return {error: "collection_not_found"};
      }
      const list = Number(params.list);
      const curated = await coll.store.db.getAllFromIndex("curatedPages", "listPages", 
        IDBKeyRange.bound([list], [list + 1]));
      return {curated};
    }

    case "deletePage": {
      const coll = await this.collections.getColl(params.coll);
      if (!coll) {
        return {error: "collection_not_found"};
      }
      const {pageSize, deleteSize} = coll.store.deletePage(params.page);

      this.collections.updateSize(params.coll, pageSize, deleteSize);

      return {pageSize, deleteSize};
    }

    default:
      return {"error": "not_found"};
    }
  }

  async listAll(filter) {
    const response = await this.collections.listAll();
    const collections = [];

    response.forEach((coll) => {
      if (coll.type === "live" || coll.type === "remoteproxy") {
        return;
      }

      if (filter && coll.type.indexOf(filter) !== 0) {
        return;
      }

      collections.push(getCollData(coll));
    });

    return {"colls": collections};
  }

  makeResponse(response, status = 200) {
    return new Response(JSON.stringify(response), {status, headers: {"Content-Type": "application/json"}});
  }
}

export { API };