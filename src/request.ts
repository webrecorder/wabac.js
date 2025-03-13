import { postToGetUrl } from "warcio";

const REPLAY_REGEX =
  /^(?::([\w-]+)\/)?(\d*)([a-z]+_|[$][a-z0-9:.-]+)?(?:\/|\||%7C|%7c)(.+)/;

export type ArchiveRequestInitOpts = {
  isRoot?: boolean;
  mod?: string;
  ts?: string;
  proxyOrigin?: string;
  localOrigin?: string;
  defaultReplayMode?: boolean;
};

export class ArchiveRequest {
  url = "";
  timestamp = "";
  mod = "";
  pageId = "";
  hash = "";
  cookie = "";

  isProxyOrigin = false;
  proxyOrigin?: string;
  localOrigin?: string;

  request: Request;
  method: string;
  mode: string;

  // eslint-disable-next-line @typescript-eslint/prefer-readonly
  private _proxyReferrer = "";

  _postToGetConverted = false;

  constructor(
    wbUrlStr: string,
    request: Request,
    {
      isRoot = false,
      mod = "",
      ts = "",
      proxyOrigin = undefined,
      localOrigin = undefined,
      defaultReplayMode = false,
    }: ArchiveRequestInitOpts = {},
  ) {
    const wbUrl = REPLAY_REGEX.exec(wbUrlStr);

    this.timestamp = ts;
    this.mod = mod;

    this.request = request;
    this.method = request.method;
    this.mode = request.mode;

    if (
      !wbUrl &&
      (wbUrlStr.startsWith("https:") ||
        wbUrlStr.startsWith("http:") ||
        wbUrlStr.startsWith("blob:"))
    ) {
      this.url = wbUrlStr;
    } else if (!wbUrl && isRoot) {
      this.url = "https://" + wbUrlStr;
    } else if (!wbUrl) {
      this.url = "";
      return;
    } else {
      this.pageId = wbUrl[1] || "";
      this.timestamp = wbUrl[2] || "";
      this.mod = wbUrl[3] || "";
      this.url = wbUrl[4] || "";
    }

    if (proxyOrigin && localOrigin && !defaultReplayMode) {
      this.url = resolveProxyOrigin(proxyOrigin, localOrigin, this.url);
      if (this.request.referrer) {
        this._proxyReferrer = resolveProxyOrigin(
          proxyOrigin,
          localOrigin,
          this.request.referrer,
        );
      }
      this.isProxyOrigin = true;
      this.proxyOrigin = proxyOrigin;
      this.localOrigin = localOrigin;
    }

    const hashIndex = this.url.indexOf("#");
    if (hashIndex > 0) {
      this.hash = this.url.slice(hashIndex);
      this.url = this.url.substring(0, hashIndex);
    }
  }

  get headers() {
    return this.request.headers;
  }

  get destination() {
    return this.request.destination;
  }

  get referrer() {
    return this._proxyReferrer || this.request.referrer;
  }

  async convertPostToGet() {
    if (this._postToGetConverted) {
      return this.url;
    }

    const request = this.request;

    if (request.method !== "POST" && request.method !== "PUT") {
      return this.url;
    }

    const data = {
      method: request.method,
      postData: await request.text(),
      headers: request.headers,
      url: this.url,
    };

    if (postToGetUrl(data)) {
      this.url = data.url;
      this.method = "GET";
      this.mode =
        this.request.mode === "navigate" ? "same-origin" : this.request.mode;
      this._postToGetConverted = true;
    }

    return this.url;
  }

  prepareProxyRequest(
    prefix: string,
    isLive = true,
  ): {
    referrer?: string;
    headers: Headers;
    credentials: RequestCredentials;
    url: string;
  } {
    let headers;
    let referrer;
    let credentials: RequestCredentials;

    if (isLive) {
      headers = new Headers(this.request.headers);
      referrer = this.request.referrer;
      const inx = referrer.indexOf("/http", prefix.length - 1);
      if (inx > 0) {
        referrer = referrer.slice(inx + 1);
        headers.set("X-Proxy-Referer", referrer);
      }
      credentials = this.request.credentials;
      if (this.cookie) {
        headers.set("X-Proxy-Cookie", this.cookie);
      }
    } else {
      headers = new Headers();
      credentials = "omit";
    }

    let url = this.url;

    if (url.startsWith("//") && referrer) {
      try {
        url = new URL(referrer).protocol + url;
      } catch (_) {
        url = "https:" + url;
      }
    }

    return { referrer, headers, credentials, url };
  }

  async getBody() {
    const request = this.request.clone();
    return new Uint8Array(await request.arrayBuffer());
  }
}

function resolveProxyOrigin(
  proxyOrigin: string,
  localOrigin: string,
  urlStr: string,
) {
  const url = new URL(urlStr);
  if (url.origin === localOrigin) {
    return proxyOrigin + url.pathname + (url.search ? url.search : "");
  }
  return urlStr;
}
