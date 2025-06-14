import { Path } from "path-parser";
import { type SWCollections } from "./swmain";
type RouteMatch = Record<string, any>;
declare class APIRouter {
    routes: Record<string, Record<string, Path>>;
    constructor(paths: Record<string, string | [string, string]>);
    match(url: string, method?: string): RouteMatch | {
        _route: null;
    };
}
declare class API {
    router: APIRouter;
    collections: SWCollections;
    constructor(collections: SWCollections);
    get routes(): Record<string, string | [string, string]>;
    apiResponse(url: string, request: Request, event: FetchEvent): Promise<Response>;
    handleApi(request: Request, params: RouteMatch, event: FetchEvent): Promise<any>;
    listAll(filter?: string | null): Promise<{
        colls: any[];
    }>;
    makeResponse(response: Response, status?: number): Response;
}
export { API };
//# sourceMappingURL=api.d.ts.map