import { getTS, makeNewResponse, fuzzyMatch } from './utils.js';

class WARCCache {
  constructor() {
    this.urlMap = {}
    this.pageList = [];
  }

  parseWarcInfo(record) {
    var dec = new TextDecoder("utf-8");
    const text = dec.decode(record.content);

    for (let line of text.split("\n")) {
      if (line.startsWith("json-metadata:")) {
        try {
          const json = JSON.parse(line.slice("json-metadata:".length));

          const pages = json.pages || [];

          for (let page of pages) {
            this.pageList.push(page);
          }

        } catch (e) { }
      }
    }
  }

  async index(record, cdx) {
    if (record.warcType === "warcinfo") {
      this.parseWarcInfo(record);
      return;
    }

    if (record.warcType !== "response" && record.warcType !== "resource") {
      return;
    }

    let url = record.warcTargetURI;
    let initInfo = null;

    const date = record.warcDate;
    const timestamp = getTS(date);

    let headers;
    let status = 200;
    let statusText = "OK";
    let content = record.content;
    let cl = 0;

    if (record.httpInfo) {
      try {
        status = parseInt(record.httpInfo.statusCode);
      } catch (e) {
      }

      // skip empty responses
      if (status === 204) {
        return;
      }

      statusText = record.httpInfo.statusReason;

      headers = new Headers(record.httpInfo.headers);

      cl = parseInt(headers.get('content-length') || 0);

      // skip partial responses (not starting from 0)
      if (status === 206) {
        const range = headers.get("content-range");

        const fullRange = `bytes 0-${cl-1}/${cl}`;

        // only include 206 responses if they are the full range
        if (range && range !== fullRange) {
          return;
        }
      }

      // skip self-redirects
      if (status > 300 && status < 400) {
        const location = headers.get('location');
        if (location) {
          if (new URL(location, url).href === url) {
            return;
          }
        }
      }
    } else {
      headers = new Headers();
      headers.set("content-type", record.warcContentType);
      headers.set("content-length", record.warcContentLength);
      cl = record.warcContentLength;
    }

    initInfo = { status, statusText, headers };

    if (cl && content.byteLength !== cl) {
      // expected mismatch due to bug in node-warc occasionally including trailing \r\n in record
      if (cl === content.byteLength - 2) {
        content = content.slice(0, cl);
      } else {
      // otherwise, warn about mismatch
        console.warn(`CL mismatch for ${url}: expected: ${cl}, found: ${content.byteLength}`);
      }
    }

    // if no pages found, start detection if hasn't started already
    if (this.detectPages === undefined) {
      this.detectPages = (this.pageList.length === 0);
    }

    if (this.detectPages) {
      if (this.isPage(url, status, headers)) {
        this.pageList.push({
          "url": url,
          "timestamp": timestamp,
          "title": url
        });
      }
    }

    this.urlMap[url] = { timestamp, date, initInfo, content };

    const fuzzyUrls = fuzzyMatch(url);

    for (let fuzzyUrl of fuzzyUrls) {
      this.urlMap[fuzzyUrl] = { timestamp, date, initInfo, content };
    }
  }

  isPage(url, status, headers) {
    if (status != 200) {
      return false;
    }

    if (!url.startsWith("http:") && !url.startsWith("https:") && !url.startsWith("blob:")) {
      return false;
    }

    if (url.endsWith("/robots.txt")) {
      return false;
    }

    // skip urls with long query
    const parts = url.split("?", 2);

    if (parts.length === 2 && parts[1].length > parts[0].length) {
      return false;
    }

    // skip 'files' starting with '.' from being listed as pages
    if (parts[0].substring(parts[0].lastIndexOf("/") + 1).startsWith(".")) {
      return false;
    }

    let contentType = headers.get("Content-Type") || "";
    contentType = contentType.split(";", 1)[0];
    if (contentType !== "text/html") {
      return false;
    }

    return true;
  }

  async match(request) {
    const entry = this.urlMap[request.url];
    if (!entry) {
      console.log(request.url);
      return null;
    }

    return makeNewResponse(entry.content,
      entry.initInfo,
      entry.timestamp,
      entry.date);
  }
}

export { WARCCache };
