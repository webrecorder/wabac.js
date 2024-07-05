import { ArchiveResponse } from "./response.js";
import { fuzzyMatcher } from "./fuzzymatcher.js";

import { WARCParser, AsyncIterReader, Source } from "warcio";
import { DBStore } from "./types.js";
import { ArchiveRequest } from "./request.js";


// ===========================================================================
export class RemoteWARCProxy implements DBStore {
  sourceUrl: string;
  type: string;
  notFoundPageUrl: string;

  constructor(rootConfig) {
    const config = rootConfig.extraConfig || {};

    this.sourceUrl = config.prefix;
    this.type = config.sourceType || "kiwix";
    this.notFoundPageUrl = config.notFoundPageUrl;
  }

  async getAllPages() {
    return [];
  }

  async getResource(request: ArchiveRequest, prefix: string) : Promise<ArchiveResponse | Response | null> {
    const { url, headers } = request.prepareProxyRequest(prefix);
    let reqHeaders = headers;

    if (this.type === "kiwix") {
      let headersData = await this.resolveHeaders(url);

      if (!headersData) {
        for (const newUrl of fuzzyMatcher.getFuzzyCanonsWithArgs(url)) {
          if (newUrl !== url) {
            headersData = await this.resolveHeaders(newUrl);
            if (headersData) {
              break;
            }
          }
        }
      }

      if (!headersData) {

        // use custom error page for navigate events
        if (this.notFoundPageUrl && request.mode === "navigate") {
          const resp = await fetch(this.notFoundPageUrl);
          // load 'not found' page template
          if (resp.status === 200) {
            const headers = {"Content-Type": "text/html"};
            const text = await resp.text();
            return new Response(text.replace("$URL", url), {status: 404, headers});
          }
        }

        return null;
      }

      let { headers, encodedUrl, date, status, statusText, hasPayload } = headersData;

      if (reqHeaders.has("Range")) {
        const range = reqHeaders.get("Range");
        // ensure uppercase range to avoid bug in kiwix-serve
        reqHeaders = {"Range": range};
      }

      let payload : AsyncIterReader | Uint8Array | null = null;

      let response : Response | null = null;

      if (hasPayload) {
        response = await fetch(this.sourceUrl + "A/" + encodedUrl, {headers: reqHeaders});

        if (response.body) {
          payload = new AsyncIterReader(response.body.getReader(), null, false);
        }

        if (response.status === 206) {
          status = 206;
          statusText = "Partial Content";
          headers.set("Content-Length", response.headers.get("Content-Length"));
          headers.set("Content-Range", response.headers.get("Content-Range"));
          headers.set("Accept-Ranges", "bytes");
        }
      }

      if (!payload) {
        payload = new Uint8Array([]);
      }

      if (!date) {
        date = new Date();
      }

      if (!headers) {
        headers = new Headers();
      }

      const isLive = false;
      const noRW = false;

      return new ArchiveResponse({payload, status, statusText, headers, url, date, noRW, isLive});
    }

    return null;
  }

  async resolveHeaders(url: string) {
    const urlNoScheme = url.slice(url.indexOf("//") + 2);

    // need to escape utf-8, then % encode the entire string
    let encodedUrl = encodeURI(urlNoScheme);
    encodedUrl = encodeURIComponent(urlNoScheme);

    let headersResp = await fetch(this.sourceUrl + "H/" + encodedUrl);

    if (headersResp.status !== 200) {
      return null;
    }

    let headers : Headers | null = null;
    let date : Date | null = null;
    let status : number | null = null;
    let statusText : string | null = null;
    let hasPayload = false;

    try {
      const record = await WARCParser.parse(headersResp.body as Source);

      if (!record) {
        return null;
      }

      if (record.warcType === "revisit") {
        const warcRevisitTarget = record.warcHeaders.headers.get("WARC-Refers-To-Target-URI");
        if (warcRevisitTarget && warcRevisitTarget !== url) {
          return await this.resolveHeaders(warcRevisitTarget);
        }
      }
      
      date = new Date(record.warcDate!);

      if (record.httpHeaders) {
        headers = record.httpHeaders.headers as Headers;
        status = Number(record.httpHeaders.statusCode);
        statusText = record.httpHeaders.statusText;
        hasPayload = record.httpHeaders.headers.get("Content-Length") !== "0";
      } else if (record.warcType === "resource") {
        headers = new Headers();
        headers.set("Content-Type", record.warcContentType || "");
        headers.set("Content-Length", record.warcContentLength + "");
        status = 200;
        statusText = "OK";
        hasPayload = record.warcContentLength > 0;
      }

      if (!status) {
        status = 200;
      }

    } catch (e) {
      console.warn(e);
      console.warn("Ignoring headers, error parsing headers response for: " + url);
    }

    return {encodedUrl, headers, date, status, statusText, hasPayload};
  }
}
