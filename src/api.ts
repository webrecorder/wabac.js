import { Path } from "path-parser";
import { getCollData } from "./utils";
import { type SWCollections } from "./swmain";
import { MultiWACZ } from "./wacz/multiwacz";

// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteMatch = Record<string, any>;

// ===========================================================================
class APIRouter {
  routes: Record<string, Record<string, Path>> = {};

  constructor(paths: Record<string, string | [string, string]>) {
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
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      this.routes[method][name] = new Path(route);
    }
  }

  match(url: string, method = "GET"): RouteMatch | { _route: null } {
    for (const [name, route] of Object.entries(this.routes[method] || [])) {
      const parts = url.split("?", 2);
      const matchUrl = parts[0];

      // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'. Type 'undefined' is not assignable to type 'string'
      const res = route.test(matchUrl);
      if (res) {
        res["_route"] = name;
        res["_query"] = new URLSearchParams(parts.length === 2 ? parts[1] : "");
        return res;
      }
    }

    return { _route: null };
  }
}

// ===========================================================================
class API {
  router: APIRouter;
  collections: SWCollections;

  constructor(collections: SWCollections) {
    this.router = new APIRouter(this.routes);

    this.collections = collections;
  }

  get routes(): Record<string, string | [string, string]> {
    return {
      index: "coll-index",
      coll: "c/:coll",
      urls: "c/:coll/urls",
      urlsTs: "c/:coll/ts/",
      createColl: ["c/create", "POST"],
      deleteColl: ["c/:coll", "DELETE"],
      updateAuth: ["c/:coll/updateAuth", "POST"],
      updateMetadata: ["c/:coll/metadata", "POST"],
      curated: "c/:coll/curated/:list",
      pages: "c/:coll/pages",
      textIndex: "c/:coll/textIndex",
      deletePage: ["c/:coll/page/:page", "DELETE"],
    };
  }

  async apiResponse(url: string, request: Request, event: FetchEvent) {
    const params = this.router.match(url, request.method);
    const response = await this.handleApi(request, params, event);
    if (response instanceof Response) {
      return response;
    }
    const status = response.error ? 404 : 200;
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.makeResponse(response, status);
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async handleApi(request: Request, params: RouteMatch, event: FetchEvent) {
    // @ts-expect-error [TODO] - TS4111 - Property '_route' comes from an index signature, so it must be accessed with ['_route'].
    switch (params._route) {
      case "index":
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        return await this.listAll(params._query.get("filter"));

      case "createColl": {
        const requestJSON = await request.json();
        const coll = await this.collections.initNewColl(
          requestJSON.metadata || {},
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          requestJSON.extraConfig || {},
        );
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return getCollData(coll);
      }

      case "coll": {
        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return { error: "collection_not_found" };
        }
        const data = getCollData(coll);

        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        if (params._query.get("all") === "1") {
          if (coll.store.db) {
            data.pages = await coll.store.getAllPages();
            data.lists = await coll.store.db.getAll("pageLists");
            data.curatedPages = await coll.store.db.getAll("curatedPages");
            if (coll.store instanceof MultiWACZ) {
              data.canQueryPages = !!coll.store.pagesQueryUrl;
            }
          } else {
            data.pages = [];
            data.lists = [];
            data.curatedPages = [];
          }

          data.verify = await coll.store.getVerifyInfo();
        } else if (coll.store.db) {
          data.numLists = await coll.store.db.count("pageLists");
          data.numPages = await coll.store.db.count("pages");
        } else {
          data.numLists = 0;
          data.numPages = 0;
        }

        // @ts-expect-error [TODO] - TS4111 - Property 'metadata' comes from an index signature, so it must be accessed with ['metadata'].
        if (coll.config.metadata.ipfsPins) {
          // @ts-expect-error [TODO] - TS4111 - Property 'metadata' comes from an index signature, so it must be accessed with ['metadata'].
          data.ipfsPins = coll.config.metadata.ipfsPins;
        }

        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return data;
      }

      case "deleteColl": {
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const keepFileHandle = params._query.get("reload") === "1";

        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        if (!(await this.collections.deleteColl(params.coll, keepFileHandle))) {
          return { error: "collection_not_found" };
        }
        return await this.listAll();
      }

      case "updateAuth": {
        const requestJSON = await request.json();
        return {
          success: await this.collections.updateAuth(
            // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            params.coll,
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            requestJSON.headers,
          ),
        };
      }

      case "updateMetadata": {
        const requestJSON = await request.json();
        const metadata = await this.collections.updateMetadata(
          // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          params.coll,
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          requestJSON,
        );
        return { metadata };
      }

      case "urls": {
        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return { error: "collection_not_found" };
        }
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const url = params._query.get("url");
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const count = Number(params._query.get("count") || 100);
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const mime = params._query.get("mime");
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const prefix = params._query.get("prefix") === "1";

        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const fromUrl = params._query.get("fromUrl");
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const fromTs = params._query.get("fromTs");
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const fromMime = params._query.get("fromMime");
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const fromStatus = Number(params._query.get("fromStatus") || 0);

        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!coll.store.resourcesByMime) {
          return { urls: [] };
        }

        let urls;

        if (url) {
          urls = await coll.store.resourcesByUrlAndMime(
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            url,
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            mime,
            count,
            prefix,
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            fromUrl,
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            fromTs,
          );
        } else {
          urls = await coll.store.resourcesByMime(
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            mime,
            count,
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            fromMime,
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            fromUrl,
            fromStatus,
          );
        }

        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        urls = urls || [];

        return { urls };
      }

      case "urlsTs": {
        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return { error: "collection_not_found" };
        }
        // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
        const url = params._query.get("url");
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const timestamps = await coll.store.getTimestampsByURL(url);

        return { timestamps: timestamps };
      }

      case "pages": {
        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return { error: "collection_not_found" };
        }
        let total = undefined;
        if (coll.store instanceof MultiWACZ) {
          // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
          const search = params._query.get("search");
          // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
          const page = Number(params._query.get("page")) || 1;
          // @ts-expect-error [TODO] - TS4111 - Property '_query' comes from an index signature, so it must be accessed with ['_query'].
          const pageSize = Number(params._query.get("pageSize")) || 25;
          if (search || page > 1) {
            const { pages, total } = await coll.store.queryPages(
              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
              search,
              page,
              pageSize,
            );
            return { pages, total };
          } else {
            total = coll.store.totalPages;
          }
        }
        const pages = await coll.store.getAllPages();
        return { pages, total };
      }

      case "textIndex": {
        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return { error: "collection_not_found" };
        }
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((coll.store as any).getTextIndex) {
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
          return await (coll.store as any).getTextIndex();
        } else {
          return {};
        }
      }

      case "curated": {
        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return { error: "collection_not_found" };
        }
        // @ts-expect-error [TODO] - TS4111 - Property 'list' comes from an index signature, so it must be accessed with ['list'].
        const list = Number(params.list);
        if (!coll.store.db) {
          return { curated: [] };
        }
        const curated = await coll.store.db.getAllFromIndex(
          "curatedPages",
          "listPages",
          IDBKeyRange.bound([list], [list + 1]),
        );
        return { curated };
      }

      case "deletePage": {
        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const coll = await this.collections.getColl(params.coll);
        if (!coll) {
          return { error: "collection_not_found" };
        }
        const { pageSize, dedupSize } = await coll.store.deletePage(
          // @ts-expect-error [TODO] - TS4111 - Property 'page' comes from an index signature, so it must be accessed with ['page'].
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          params.page,
        );

        // @ts-expect-error [TODO] - TS4111 - Property 'coll' comes from an index signature, so it must be accessed with ['coll'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-argument
        this.collections.updateSize(params.coll, pageSize, dedupSize);

        return { pageSize, dedupSize };
      }

      default:
        return { error: "not_found" };
    }
  }

  async listAll(filter?: string | null) {
    const response = await this.collections.listAll();
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collections: any[] = [];

    response.forEach((coll) => {
      if (coll.type === "live" || coll.type === "remoteproxy") {
        return;
      }

      if (filter && !coll.type.startsWith(filter)) {
        return;
      }

      collections.push(getCollData(coll));
    });

    return { colls: collections };
  }

  makeResponse(response: Response, status = 200) {
    return new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export { API };
