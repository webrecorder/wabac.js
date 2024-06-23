export class API {
    constructor(collections: any);
    router: APIRouter;
    collections: any;
    get routes(): {
        index: string;
        coll: string;
        urls: string;
        urlsTs: string;
        createColl: string[];
        deleteColl: string[];
        updateAuth: string[];
        updateMetadata: string[];
        curated: string;
        pages: string;
        textIndex: string;
        deletePage: string[];
    };
    apiResponse(url: any, request: any, event: any): Promise<Response>;
    handleApi(request: any, params: any): Promise<any>;
    listAll(filter: any): Promise<{
        colls: any[];
    }>;
    makeResponse(response: any, status?: number): Response;
}
declare class APIRouter {
    constructor(paths: any);
    routes: {};
    match(url: any, method?: string): any;
}
export {};
//# sourceMappingURL=api.d.ts.map