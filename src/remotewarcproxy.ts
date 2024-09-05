import { ArchiveResponse } from "./response";
import { fuzzyMatcher } from "./fuzzymatcher";

import { WARCParser, AsyncIterReader, type Source } from "warcio";
import { type DBStore } from "./types";
import { type ArchiveRequest } from "./request";

// ===========================================================================
export class RemoteWARCProxy implements DBStore {
  sourceUrl: string;
  type: string;
  notFoundPageUrl: string;

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(rootConfig: Record<string, any>) {
    // @ts-expect-error [TODO] - TS4111 - Property 'extraConfig' comes from an index signature, so it must be accessed with ['extraConfig'].
    const config = rootConfig.extraConfig || {};

    this.sourceUrl = config.prefix;
    this.type = config.sourceType || "kiwix";
    this.notFoundPageUrl = config.notFoundPageUrl;
  }

  async getAllPages() {
    return [];
  }

  async getResource(
    request: ArchiveRequest,
    prefix: string,
  ): Promise<ArchiveResponse | Response | null> {
    const { url, headers } = request.prepareProxyRequest(prefix);
    let reqHeaders: HeadersInit = headers;

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
            const headers = { "Content-Type": "text/html" };
            const text = await resp.text();
            return new Response(text.replace("$URL", url), {
              status: 404,
              headers,
            });
          }
        }

        return null;
      }

      // [TODO]
      // eslint-disable-next-line prefer-const
      let { headers, encodedUrl, date, status, statusText, hasPayload } =
        headersData;

      if (reqHeaders.has("Range")) {
        const range = reqHeaders.get("Range");
        // ensure uppercase range to avoid bug in kiwix-serve
        if (range) {
          reqHeaders = { Range: range };
        }
      }

      let payload: AsyncIterReader | Uint8Array | null = null;

      let response: Response | null = null;

      if (!headers) {
        headers = new Headers();
      }

      if (hasPayload) {
        response = await fetch(this.sourceUrl + "A/" + encodedUrl, {
          headers: reqHeaders,
        });

        if (response.body) {
          payload = new AsyncIterReader(response.body.getReader(), null, false);
        }

        if (response.status === 206) {
          const CL = response.headers.get("Content-Length");
          const CR = response.headers.get("Content-Range");
          if (CL && CR) {
            status = 206;
            statusText = "Partial Content";
            headers.set("Content-Length", CL);
            headers.set("Content-Range", CR);
            headers.set("Accept-Ranges", "bytes");
          }
        }
      }

      if (!payload) {
        payload = new Uint8Array([]);
      }

      if (!date) {
        date = new Date();
      }

      const isLive = false;
      const noRW = false;

      return new ArchiveResponse({
        payload,
        status,
        statusText,
        headers,
        url,
        date,
        noRW,
        isLive,
      });
    }

    return null;
  }

  async resolveHeaders(url: string): Promise<{
    encodedUrl: string;
    headers: Headers | null;
    date: Date | null;
    status: number;
    statusText: string;
    hasPayload: boolean;
  } | null> {
    const urlNoScheme = url.slice(url.indexOf("//") + 2);

    // need to escape utf-8, then % encode the entire string
    let encodedUrl = encodeURI(urlNoScheme);
    encodedUrl = encodeURIComponent(urlNoScheme);

    const headersResp = await fetch(this.sourceUrl + "H/" + encodedUrl);

    if (headersResp.status !== 200) {
      return null;
    }

    let headers: Headers | null = null;
    let date: Date | null = null;
    let status = 200;
    let statusText = "OK";
    let hasPayload = false;

    try {
      const record = await WARCParser.parse(headersResp.body as Source);

      if (!record) {
        return null;
      }

      if (record.warcType === "revisit") {
        const warcRevisitTarget = record.warcHeaders.headers.get(
          "WARC-Refers-To-Target-URI",
        );
        if (warcRevisitTarget && warcRevisitTarget !== url) {
          return await this.resolveHeaders(warcRevisitTarget);
        }
      }

      date = new Date(record.warcDate!);

      if (record.httpHeaders) {
        headers = record.httpHeaders.headers as Headers;
        status = Number(record.httpHeaders.statusCode);
        statusText = record.httpHeaders.statusText || "";
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
      console.warn(
        "Ignoring headers, error parsing headers response for: " + url,
      );
    }

    return { encodedUrl, headers, date, status, statusText, hasPayload };
  }
}
