/**
 * Mini wombat for performing URL rewriting within the
 * Web/Shared/Service Worker context
 * @param {Object} info
 * @return {WBWombat}
 */
declare function WBWombat(info: any): WBWombat;
declare class WBWombat {
    /**
     * Mini wombat for performing URL rewriting within the
     * Web/Shared/Service Worker context
     * @param {Object} info
     * @return {WBWombat}
     */
    constructor(info: any);
    /** @type {Object} */
    info: any;
    /**
     * Returns T/F indicating if the supplied URL is not to be rewritten
     * @param {string} url
     * @return {boolean}
     */
    noRewrite(url: string): boolean;
    /**
     * Returns T/F indicating if the supplied URL is an relative URL
     * @param {string} url
     * @return {boolean}
     */
    isRelURL(url: string): boolean;
    /**
     * Attempts to resolve the supplied relative URL against
     * the origin this worker was created on
     * @param {string} maybeRelURL
     * @param {string} against
     * @return {string}
     */
    maybeResolveURL(maybeRelURL: string, against: string): string;
    /**
     * Returns null to indicate that the supplied URL is not to be rewritten.
     * Otherwise returns a URL that can be rewritten
     * @param {*} url
     * @param {string} resolveAgainst
     * @return {?string}
     */
    ensureURL(url: any, resolveAgainst: string): string | null;
    /**
     * Rewrites the supplied URL
     * @param {string} url
     * @return {string}
     */
    rewriteURL(url: string): string;
    /**
     * Rewrites the supplied URL of an controlled page using the mp\_ modifier
     * @param {string} url
     * @param {WindowClient} [client]
     * @return {string}
     */
    rewriteClientWindowURL(url: string, client?: WindowClient | undefined): string;
    /**
     * Mini url rewriter specifically for rewriting web sockets
     * @param {?string} originalURL
     * @return {string}
     */
    rewriteWSURL(originalURL: string | null): string;
    /**
     * Rewrites all URLs in the supplied arguments object
     * @param {Object} argsObj
     * @return {Array<string>}
     */
    rewriteArgs(argsObj: any): Array<string>;
    /**
     * Rewrites the input to one of the Fetch APIs
     * @param {*|string|Request} input
     * @return {*|string|Request}
     */
    rewriteFetchApi(input: any | string | Request): any | string | Request;
    /**
     * Rewrites the input to one of the Cache APIs
     * @param {*|string|Request} request
     * @return {*|string|Request}
     */
    rewriteCacheApi(request: any | string | Request): any | string | Request;
    /**
     * Applies an override to the importScripts function
     * @see https://html.spec.whatwg.org/multipage/workers.html#dom-workerglobalscope-importscripts
     */
    initImportScriptsRewrite(): void;
    /**
     * Applies overrides to the XMLHttpRequest.open and XMLHttpRequest.responseURL
     * in order to ensure URLs are rewritten.
     *
     * Applies an override to window.fetch in order to rewrite URLs and URLs of
     * the supplied Request objects used as arguments to fetch.
     *
     * Applies overrides to window.Request, window.Response, window.EventSource,
     * and window.WebSocket in order to ensure URLs they operate on are rewritten.
     *
     * @see https://xhr.spec.whatwg.org/
     * @see https://fetch.spec.whatwg.org/
     * @see https://html.spec.whatwg.org/multipage/web-sockets.html#websocket
     * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface
     */
    initHTTPOverrides(): void;
    /**
     * Applies an override to Clients.openWindow and WindowClient.navigate that rewrites
     * the supplied URL that represents a controlled window
     * @see https://w3c.github.io/ServiceWorker/#window-client-interface
     * @see https://w3c.github.io/ServiceWorker/#clients-interface
     */
    initClientApisOverride(): void;
    /**
     * Applies overrides to the CacheStorage and Cache interfaces in order
     * to rewrite the URLs they operate on
     * @see https://w3c.github.io/ServiceWorker/#cachestorage
     * @see https://w3c.github.io/ServiceWorker/#cache-interface
     */
    initCacheApisOverride(): void;
}
//# sourceMappingURL=wombatWorkers.d.ts.map