import { ArchiveResponse } from "./response";


// ===========================================================================
export class LiveProxy {
  constructor(extraConfig, {cloneResponse = false, allowBody = false, hostProxyOnly = false} = {}) {
    extraConfig = extraConfig || {};

    this.prefix = extraConfig.prefix || "";
    this.proxyPathOnly = extraConfig.proxyPathOnly || false;
    this.isLive = extraConfig.isLive !== undefined ? extraConfig.isLive : true;
    this.archivePrefix = extraConfig.archivePrefix || "";
    this.cloneResponse = cloneResponse;
    this.allowBody = allowBody;

    this.hostProxy = extraConfig.hostProxy;
    this.hostProxyOnly = hostProxyOnly;
  }

  async getAllPages() {
    return [];
  }

  getFetchUrl(url, request) {
    let parsedUrl;

    if (this.hostProxy) {
      parsedUrl = new URL(url);
      const hostdata = this.hostProxy[parsedUrl.host];
      if (hostdata) {
        return hostdata.prefix + (hostdata.pathOnly ? parsedUrl.pathname + parsedUrl.search : url);
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
      return this.prefix + this.archivePrefix + request.timestamp + "id_/" + url;
    }
  }


  async getResource(request, prefix) {
    const { headers, credentials, url} = request.prepareProxyRequest(prefix, true);

    const fetchUrl = this.getFetchUrl(url, request);
    if (!fetchUrl) {
      return null;
    }

    let body = null;

    if (this.allowBody && (request.method === "POST" || request.method === "PUT")) {
      body = await request.getBody();
    }

    const response = await fetch(fetchUrl, {
      method: request.method,
      body,
      headers,
      credentials,
      mode: "cors",
      redirect: "follow"
    });

    let clonedResponse = null;

    if (this.cloneResponse) {
      clonedResponse = response.clone();
    }

    const archiveResponse = ArchiveResponse.fromResponse({url,
      response,
      date: new Date(),
      noRW: false,
      isLive: this.isLive,
    });

    if (clonedResponse) {
      archiveResponse.clonedResponse = clonedResponse;
    }

    return archiveResponse;
  }
}
