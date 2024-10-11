import { getProxyNotFoundResponse } from "./notfound";
import { type ArchiveRequest } from "./request";
import { ArchiveResponse } from "./response";
import { type DBStore } from "./types";

declare let self: ServiceWorkerGlobalScope;

// ===========================================================================
export class LiveProxy implements DBStore {
  prefix: string;
  proxyPathOnly: boolean;
  isLive: boolean;
  archivePrefix: string;
  cloneResponse: boolean;
  allowBody: boolean;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hostProxy: Record<string, any>;
  hostProxyOnly: boolean;

  messageOnProxyErrors: boolean;

  constructor(
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extraConfig: Record<string, any>,
    { cloneResponse = false, allowBody = false, hostProxyOnly = false } = {},
  ) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    extraConfig = extraConfig || {};

    // @ts-expect-error [TODO] - TS4111 - Property 'prefix' comes from an index signature, so it must be accessed with ['prefix'].
    this.prefix = extraConfig.prefix || "";
    // @ts-expect-error [TODO] - TS4111 - Property 'proxyPathOnly' comes from an index signature, so it must be accessed with ['proxyPathOnly'].
    this.proxyPathOnly = extraConfig.proxyPathOnly || false;
    // @ts-expect-error [TODO] - TS4111 - Property 'isLive' comes from an index signature, so it must be accessed with ['isLive']. | TS4111 - Property 'isLive' comes from an index signature, so it must be accessed with ['isLive'].
    this.isLive = extraConfig.isLive !== undefined ? extraConfig.isLive : true;
    // @ts-expect-error [TODO] - TS4111 - Property 'archivePrefix' comes from an index signature, so it must be accessed with ['archivePrefix'].
    this.archivePrefix = extraConfig.archivePrefix || "";
    this.cloneResponse = cloneResponse;
    this.allowBody = allowBody || this.isLive;

    // @ts-expect-error [TODO] - TS4111 - Property 'messageOnProxyErrors' comes from an index signature, so it must be accessed with ['messageOnProxyErrors'].
    this.messageOnProxyErrors = extraConfig.messageOnProxyErrors || false;

    // @ts-expect-error [TODO] - TS4111 - Property 'hostProxy' comes from an index signature, so it must be accessed with ['hostProxy'].
    this.hostProxy = extraConfig.hostProxy;

    if (this.hostProxy instanceof Array) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byHost: Record<string, any> = {};
      for (const entry of this.hostProxy) {
        byHost[entry.host] = entry;
      }
      this.hostProxy = byHost;
    }

    this.hostProxyOnly = hostProxyOnly;
  }

  async getAllPages() {
    return [];
  }

  getFetchUrl(url: string, request: ArchiveRequest, headers: Headers) {
    let parsedUrl;

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.hostProxy) {
      parsedUrl = new URL(url);
      const hostdata = this.hostProxy[parsedUrl.host];
      if (hostdata) {
        // set X-Proxy-Host to matched host
        headers.set("X-Proxy-Host", parsedUrl.host);
        // Given https://example.com/path/somefile.html, and prefix "https://upstream-server/prefix/"
        // with pathOnly, send to https://upstream-server/prefix/path/somefile.html
        // without pathOnly, send to https://upstream-server/prefix/https://example.com/path/somefile.html
        return (
          hostdata.prefix +
          (hostdata.pathOnly ? parsedUrl.pathname + parsedUrl.search : url)
        );
      }
    }

    if (this.hostProxyOnly) {
      return null;
    }

    if (this.proxyPathOnly) {
      if (!parsedUrl) {
        parsedUrl = new URL(url);
      }
      return this.prefix + parsedUrl.pathname + parsedUrl.search;
    } else if (this.isLive || !request.timestamp) {
      return this.prefix + url;
    } else {
      return (
        this.prefix + this.archivePrefix + request.timestamp + "id_/" + url
      );
    }
  }

  async getResource(request: ArchiveRequest, prefix: string) {
    const { headers, credentials, url } = request.prepareProxyRequest(
      prefix,
      true,
    );

    const fetchUrl = this.getFetchUrl(url, request, headers);

    if (!fetchUrl) {
      return null;
    }

    let body: Uint8Array | null = null;

    const isPOST =
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "DELETE";

    if (isPOST) {
      if (this.allowBody) {
        body = await request.getBody();
      } else {
        void this.sendProxyError("post-request-attempt", url, request.method);
      }
    }

    let response = await fetch(fetchUrl, {
      method: request.method,
      body,
      headers,
      credentials,
      mode: "cors",
      redirect: "follow",
    });

    let noRW = false;

    if (isPOST && response.status >= 400) {
      void this.sendProxyError(
        "post-request-failed",
        url,
        request.method,
        response.status,
      );
    } else if (response.status === 429) {
      void this.sendProxyError(
        "rate-limited",
        url,
        request.method,
        response.status,
      );
    }

    if (
      response.status > 400 &&
      response.status !== 404 &&
      ["", "document", "iframe"].includes(request.destination)
    ) {
      response = getProxyNotFoundResponse(url, response.status);
      noRW = true;
    }

    let clonedResponse: Response | null = null;

    if (this.cloneResponse) {
      clonedResponse = response.clone();
    }

    const archiveResponse = ArchiveResponse.fromResponse({
      url,
      response,
      date: new Date(),
      noRW,
      isLive: this.isLive,
      archivePrefix: this.archivePrefix,
    });

    if (clonedResponse) {
      archiveResponse.clonedResponse = clonedResponse;
    }

    return archiveResponse;
  }

  async sendProxyError(
    type: string,
    url: string,
    method: string,
    status?: number,
  ) {
    if (!this.messageOnProxyErrors) {
      return;
    }

    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      const clientUrl = new URL(client.url);
      if (clientUrl.searchParams.get("source") === this.prefix) {
        client.postMessage({ type, url, method, status });
        break;
      }
    }
  }
}
