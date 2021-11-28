import { postToGetUrl } from "warcio";

const REPLAY_REGEX = /^(?::([\w-]+)\/)?(\d*)([a-z]+_|[$][a-z0-9:.-]+)?(?:\/|\||%7C|%7c)(.+)/;


export class ArchiveRequest
{
  constructor(wbUrlStr, request, {isRoot = false, mod = "", ts = "", proxyOrigin = null, localOrigin = null} = {})
  {
    const wbUrl = REPLAY_REGEX.exec(wbUrlStr);

    this.url = "";
    this.timestamp = ts;
    this.mod = mod;
    this.pageId = "";
    this.hash = "";

    if (!wbUrl && (wbUrlStr.startsWith("https:") || wbUrlStr.startsWith("http:") || wbUrlStr.startsWith("blob:"))) {
      this.url = wbUrlStr;
    } else if (!wbUrl && isRoot) {
      this.url = "https://" + wbUrlStr;
    } else if (!wbUrl) {
      this.url = null;
      return;
    } else {
      this.pageId = wbUrl[1] || "";
      this.timestamp = wbUrl[2];
      this.mod = wbUrl[3];
      this.url = wbUrl[4];
    }

    if (proxyOrigin && localOrigin) {
      const url = new URL(this.url);
      if (url.origin === localOrigin) {
        this.url = proxyOrigin + url.pathname + (url.search ? url.search : "");
      }
    }

    const hashIndex = this.url.indexOf("#");
    if (hashIndex > 0) {
      this.hash = this.url.slice(hashIndex);
      this.url = this.url.substring(0, hashIndex);
    }

    this.request = request;
    this.method = request.method;
    this.mode = request.mode;
    this._postToGetConverted = false;
  }

  get headers() {
    return this.request.headers;
  }

  get destination() {
    return this.request.destination;
  }

  get referrer() {
    return this.request.referrer;
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
      url: this.url
    };

    if (postToGetUrl(data)) {
      this.url = data.url;
      this.method = "GET";
      this.mode = this.request.mode === "navigate" ? "same-origin" : this.request.mode;
      this._postToGetConverted = true;
    }

    return this.url;
  }

  prepareProxyRequest(prefix, isLive = true) {
    let headers;
    let referrer;
    let credentials;

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

    if (url.startsWith("//")) {
      try {
        url = new URL(referrer).protocol + url;
      } catch(e) {
        url = "https:" + url;
      }
    }

    return {referrer, headers, credentials, url};
  }

  async getBody() {
    const request = this.request.clone();
    return new Uint8Array(await request.arrayBuffer());
  }
}
