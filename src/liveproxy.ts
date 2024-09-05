import { type ArchiveRequest } from "./request";
import { ArchiveResponse } from "./response";
import { type DBStore } from "./types";

// ===========================================================================
export class LiveProxy implements DBStore {
  prefix: string;
  proxyPathOnly: boolean;
  isLive: boolean;
  archivePrefix: string;
  cloneResponse: boolean;
  allowBody: boolean;
  hostProxy: Record<string, any>;
  hostProxyOnly: boolean;

  constructor(
    extraConfig: Record<string, any>,
    { cloneResponse = false, allowBody = false, hostProxyOnly = false } = {},
  ) {
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

    // @ts-expect-error [TODO] - TS4111 - Property 'hostProxy' comes from an index signature, so it must be accessed with ['hostProxy'].
    this.hostProxy = extraConfig.hostProxy;

    if (this.hostProxy instanceof Array) {
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

    if (
      this.allowBody &&
      (request.method === "POST" || request.method === "PUT")
    ) {
      body = await request.getBody();
    }

    const response = await fetch(fetchUrl, {
      method: request.method,
      body,
      headers,
      credentials,
      mode: "cors",
      redirect: "follow",
    });

    let clonedResponse: Response | null = null;

    if (this.cloneResponse) {
      clonedResponse = response.clone();
    }

    const archiveResponse = ArchiveResponse.fromResponse({
      url,
      response,
      date: new Date(),
      noRW: false,
      isLive: this.isLive,
      archivePrefix: this.archivePrefix,
    });

    if (clonedResponse) {
      archiveResponse.clonedResponse = clonedResponse;
    }

    return archiveResponse;
  }
}
