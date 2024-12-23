import LinkHeader from "http-link-header";

import { isAjaxRequest } from "../utils";

import { decodeResponse } from "./decoder";

import { rewriteDASH, rewriteHLS } from "./rewriteVideo";

import {
  DomainSpecificRuleSet,
  hasRangeAsQuery,
  HTML_ONLY_RULES,
} from "./dsruleset";

import { RxRewriter } from "./rxrewriter";
import { JSRewriter } from "./jsrewriter";

import { HTMLRewriter } from "./html";
import { type ArchiveRequest } from "../request";
import { type ArchiveResponse } from "../response";

// keep for backwards compatibility with RWP and AWP
export { ArchiveResponse } from "../response";

export { rewriteDASH, rewriteHLS } from "./rewriteVideo";

// ===========================================================================
const STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/gi;

const IMPORT_REGEX = /(@import\s*[\\"']*)([^)'";]+)([\\"']*\s*;?)/gi;

const NO_WOMBAT_REGEX = /WB_wombat_/g;

//const JSONP_REGEX = /^(?:[ \t]*(?:(?:\/\*[^\*]*\*\/)|(?:\/\/[^\n]+[\n])))*[ \t]*(\w+)\(\{/m;
const JSONP_REGEX =
  /^(?:\s*(?:(?:\/\*[^*]*\*\/)|(?:\/\/[^\n]+[\n])))*\s*([\w.]+)\([{[]/;

const JSONP_CALLBACK_REGEX = /[?].*(?:callback|jsonp)=([^&]+)/i;

// ===========================================================================
// JS Rewriters
export const jsRules = new DomainSpecificRuleSet(JSRewriter);
export const baseRules = new DomainSpecificRuleSet(RxRewriter);

// HTML Rx Rewriter (only used externally for now)
export const htmlRules = new DomainSpecificRuleSet(RxRewriter, HTML_ONLY_RULES);

type InsertFunc = (url: string) => string;

type RewriterOpts = {
  baseUrl: string;
  prefix: string;
  responseUrl?: string;
  workerInsertFunc?: InsertFunc | null;
  headInsertFunc?: InsertFunc | null;
  urlRewrite?: boolean;
  contentRewrite?: boolean;
  decode?: boolean;
  useBaseRules?: boolean;
};

export function getCustomRewriter(url: string, isHTML: boolean) {
  const rules = isHTML ? htmlRules : baseRules;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return rules.getCustomRewriter(url);
}

// ===========================================================================
export class Rewriter {
  urlRewrite: boolean;
  contentRewrite: boolean;

  baseUrl: string;

  dsRules: DomainSpecificRuleSet;

  decode: boolean;

  prefix: string;
  originPrefix = "";
  relPrefix = "";
  schemeRelPrefix = "";
  scheme: string;
  url: string;
  responseUrl: string;
  isCharsetUTF8: boolean;

  headInsertFunc: InsertFunc | null;
  workerInsertFunc: InsertFunc | null;

  _jsonpCallback: string | boolean | null;

  constructor({
    baseUrl,
    prefix,
    responseUrl = undefined,
    workerInsertFunc = null,
    headInsertFunc = null,
    urlRewrite = true,
    contentRewrite = true,
    decode = true,
    useBaseRules = false,
  }: RewriterOpts) {
    this.urlRewrite = urlRewrite;
    this.contentRewrite = contentRewrite;
    this.dsRules = urlRewrite && !useBaseRules ? jsRules : baseRules;
    this.decode = decode;

    this.prefix = prefix || "";
    if (this.prefix && urlRewrite) {
      const parsed = new URL(this.prefix);
      this.originPrefix = parsed.origin;
      this.relPrefix = parsed.pathname;
      this.schemeRelPrefix = this.prefix.slice(parsed.protocol.length);
    }

    // response url always has a scheme, should be specified if baseUrl may not..
    const parsed = new URL(responseUrl || baseUrl);
    this.scheme = parsed.protocol;

    if (baseUrl.startsWith("//")) {
      baseUrl = this.scheme + baseUrl;
    }

    this.url = this.baseUrl = baseUrl;

    this.headInsertFunc = headInsertFunc;
    this.workerInsertFunc = workerInsertFunc;
    this.responseUrl = responseUrl || baseUrl;
    this.isCharsetUTF8 = false;

    this._jsonpCallback = null;
  }

  getRewriteMode(
    request: ArchiveRequest,
    response: ArchiveResponse,
    url = "",
    mime = "",
  ) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!mime && response) {
      mime = response.headers.get("Content-Type") || "";
      const parts = mime.split(";");
      // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string'.
      mime = parts[0];
      if (parts.length > 1) {
        this.isCharsetUTF8 =
          // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
          parts[1]
            .trim()
            .toLowerCase()
            .replace("charset=", "")
            .replace("-", "") === "utf8";
      }
    }
    mime = mime.toLowerCase();
    if (request.mod === "esm_") {
      this.isCharsetUTF8 = true;
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (request) {
      switch (request.destination) {
        case "style":
          return "css";

        case "script":
          return this.getScriptRewriteMode(mime, url, "js");

        case "worker":
          return "js-worker";
      }
    }

    switch (mime) {
      case "text/html":
        if (
          !request.destination &&
          request.headers.get("Accept") === "application/json"
        ) {
          return "json";
        }
        return "html";

      case "text/css":
        return "css";

      case "application/x-mpegurl":
      case "application/vnd.apple.mpegurl":
        return "hls";

      case "application/dash+xml":
        return "dash";

      default:
        return this.getScriptRewriteMode(mime, url);
    }
  }

  getScriptRewriteMode(mime: string, url: string, defaultType = "") {
    switch (mime) {
      case "text/javascript":
      case "application/javascript":
      case "application/x-javascript":
        if (this.parseJSONPCallback(url)) {
          return "jsonp";
        }
        return url.endsWith(".json") ? "json" : "js";

      case "application/json":
        return "json";

      default:
        return defaultType;
    }
  }

  async rewrite(
    response: ArchiveResponse,
    request: ArchiveRequest,
  ): Promise<ArchiveResponse> {
    const rewriteMode = this.contentRewrite
      ? this.getRewriteMode(request, response, this.baseUrl)
      : null;

    const isAjax = isAjaxRequest(request);

    const urlRewrite = this.urlRewrite && !isAjax;

    const headers = this.rewriteHeaders(
      response.headers,
      this.urlRewrite,
      !!rewriteMode,
      isAjax,
    );

    const encoding = response.headers.get("content-encoding");
    const te = response.headers.get("transfer-encoding");

    response.headers = headers;

    // attempt to decode only if set
    // eg. data may already be decoded for many stores
    if (this.decode && (encoding || te)) {
      response = await decodeResponse(
        response,
        encoding,
        te,
        rewriteMode === null,
      );
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: any = {
      response,
      prefix: this.prefix,
      baseUrl: this.baseUrl,
    };

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rwFunc: ((x: string, opts: any) => string) | null = null;

    switch (rewriteMode) {
      case "html":
        if (urlRewrite) {
          return await this.rewriteHtml(response);
        }
        break;

      case "css":
        if (this.urlRewrite) {
          rwFunc = this.rewriteCSS;
        }
        break;

      case "js":
        rwFunc = this.rewriteJS;
        if (request.mod === "esm_") {
          opts.isModule = true;
        }
        break;

      case "json":
        rwFunc = this.rewriteJSON;
        break;

      case "js-worker":
        rwFunc = this.workerInsertFunc;
        break;

      case "jsonp":
        rwFunc = this.rewriteJSONP;
        break;

      case "hls":
        rwFunc = rewriteHLS;
        break;

      case "dash":
        rwFunc = rewriteDASH;
        break;
    }

    if (urlRewrite) {
      opts.rewriteUrl = (url: string) => this.rewriteUrl(url);
    }

    if (rwFunc) {
      // [TODO]
      // eslint-disable-next-line prefer-const
      let { bomFound, text } = await response.getText(this.isCharsetUTF8);
      text = rwFunc.call(this, text, opts);
      // if BOM found and not already UTF-8, add charset explicitly
      if (bomFound && !this.isCharsetUTF8) {
        let mime = headers.get("Content-Type") || "";
        const parts = mime.split(";");
        // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string'.
        mime = parts[0];
        if (mime) {
          headers.set("Content-Type", mime + "; charset=utf-8");
        }
        this.isCharsetUTF8 = true;
      }
      response.setText(text, this.isCharsetUTF8);
    } else {
      // check range-as-query
      const result = hasRangeAsQuery(request.url);
      if (result) {
        const url = new URL(request.url);
        const start = parseInt(url.searchParams.get(result.start) || "");
        const end = parseInt(url.searchParams.get(result.end) || "");
        if (!isNaN(start) && !isNaN(end)) {
          const existingLen = Number(response.headers.get("Content-Length"));
          const newLen = end - start + 1;
          if (
            existingLen !== newLen &&
            (isNaN(existingLen) || existingLen > newLen) &&
            response.setRawRange(start, end)
          ) {
            response.headers.set("Content-Length", String(newLen));
          }
        }
      }
    }

    return response;
  }

  updateBaseUrl(url: string) {
    // if already rewritten, unrewrite first
    if (this.originPrefix && url.startsWith(this.originPrefix)) {
      const inx = url.indexOf("/http");
      if (inx >= 0) {
        url = url.slice(inx + 1);
      }
    }

    // set internal base to full url
    this.baseUrl = new URL(url, this.baseUrl).href;

    // not an absolute url, ensure it has slash
    if (url && this.baseUrl != url) {
      try {
        url = new URL(url).href;
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        if (url.startsWith("//")) {
          url = new URL("https:" + url).href;
          url = url.slice("https:".length);
        }
      }
    }

    // return rewritten base url, but keeping scheme-relativeness
    return this.rewriteUrl(url);
  }

  isRewritableUrl(url: string) {
    const NO_REWRITE_URI_PREFIX = [
      "#",
      "javascript:",
      "data:",
      "mailto:",
      "about:",
      "file:",
      "blob:",
      "{",
    ];

    for (const prefix of NO_REWRITE_URI_PREFIX) {
      if (url.startsWith(prefix)) {
        return false;
      }
    }

    return true;
  }

  rewriteUrl(url: string, forceAbs = false) {
    if (!this.urlRewrite) {
      return url;
    }

    const origUrl = url;

    url = url.trim();

    if (
      !url ||
      !this.isRewritableUrl(url) ||
      url.startsWith(this.prefix) ||
      url.startsWith(this.relPrefix)
    ) {
      return origUrl;
    }

    if (
      url.startsWith("http:") ||
      url.startsWith("https:") ||
      url.startsWith("https\\3a/")
    ) {
      return this.prefix + url;
    }

    if (url.startsWith("//") || url.startsWith("\\/\\/")) {
      return this.schemeRelPrefix + url;
    }

    if (url.startsWith("/")) {
      url = new URL(url, this.baseUrl).href;
      return this.relPrefix + url;
    } else if (forceAbs || url.indexOf("../") >= 0) {
      url = new URL(url, this.baseUrl).href;
      return this.prefix + url;
    } else {
      return origUrl;
    }
  }

  // HTML
  async rewriteHtml(response: ArchiveResponse) {
    const htmlRW = new HTMLRewriter(this, this.isCharsetUTF8);
    return htmlRW.rewrite(response);
  }

  // CSS
  rewriteCSS(text: string) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rewriter = this;

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function cssStyleReplacer(match: any, n1: string, n2: string, n3: string) {
      n2 = n2.trim();
      return n1 + rewriter.rewriteUrl(n2) + n3;
    }

    return text
      .replace(STYLE_REGEX, cssStyleReplacer)
      .replace(IMPORT_REGEX, cssStyleReplacer)
      .replace(NO_WOMBAT_REGEX, "");
  }

  // JS
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rewriteJS(text: string, opts: Record<string, any>) {
    const noUrlProxyRewrite =
      // @ts-expect-error [TODO] - TS4111 - Property 'rewriteUrl' comes from an index signature, so it must be accessed with ['rewriteUrl']. | TS4111 - Property 'isModule' comes from an index signature, so it must be accessed with ['isModule']. | TS4111 - Property 'inline' comes from an index signature, so it must be accessed with ['inline'].
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      opts && !opts.rewriteUrl && opts.isModule === undefined && !opts.inline;
    const dsRules = noUrlProxyRewrite ? baseRules : this.dsRules;
    const dsRewriter = dsRules.getRewriter(this.baseUrl);

    // optimize: if default rewriter and not rewriting urls, skip
    if (dsRewriter === dsRules.defaultRewriter && noUrlProxyRewrite) {
      return text;
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return dsRewriter.rewrite(text, opts);
  }

  // JSON
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rewriteJSON(text: string, opts: Record<string, any>) {
    text = this.rewriteJSONP(text);

    const dsRewriter = baseRules.getRewriter(this.baseUrl);

    if (dsRewriter !== baseRules.defaultRewriter) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return dsRewriter.rewrite(text, opts);
    }

    return text;
  }

  // Importmap
  rewriteImportmap(text: string) {
    try {
      const root = JSON.parse(text);

      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imports: Record<string, any> = {};
      const output = { imports };

      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      for (const [key, value] of Object.entries(root.imports || {})) {
        imports[this.rewriteUrl(key).replace("mp_/", "esm_/")] = value;
      }

      if (root.scopes) {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scopes: Record<string, any> = {};
        for (const [scopeKey, scopeValue] of Object.entries(
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          root.scopes || {},
        )) {
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newScope: Record<string, any> = {};
          for (const [key, value] of Object.entries(
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            scopeValue as Record<string, any>,
          )) {
            newScope[this.rewriteUrl(key).replace("mp_/", "esm_/")] = value;
          }
          scopes[this.rewriteUrl(scopeKey).replace("mp_/", "esm_/")] = newScope;
        }
        // @ts-expect-error [TODO] - TS4111 - Property 'scopes' comes from an index signature, so it must be accessed with ['scopes'].
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (output as Record<string, any>).scopes = scopes;
      }

      return JSON.stringify(output, null, 2);
    } catch (e) {
      console.warn("Error parsing importmap", e);
      return text;
    }
  }

  parseJSONPCallback(url: string) {
    const callback = url.match(JSONP_CALLBACK_REGEX);
    if (!callback || callback[1] === "?") {
      this._jsonpCallback = false;
      return false;
    }

    // @ts-expect-error [TODO] - TS2322 - Type 'string | undefined' is not assignable to type 'string | boolean | null'.
    this._jsonpCallback = callback[1];
    return true;
  }

  // JSONP
  rewriteJSONP(text: string) {
    const jsonM = text.match(JSONP_REGEX);
    if (!jsonM) {
      return text;
    }

    // if null, hasn't been parsed yet
    if (this._jsonpCallback === null) {
      this.parseJSONPCallback(this.baseUrl);
    }

    if (this._jsonpCallback === false) {
      return text;
    }

    return (
      // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'. | TS2532 - Object is possibly 'undefined'.
      this._jsonpCallback + text.slice(text.indexOf(jsonM[1]) + jsonM[1].length)
    );
  }

  //Headers
  rewriteHeaders(
    headers: Headers,
    urlRewrite: boolean,
    contentRewrite: boolean,
    isAjax: boolean,
  ) {
    const headerRules: Record<string, string> = {
      "access-control-allow-origin": "prefix-if-url-rewrite",
      "access-control-allow-credentials": "prefix-if-url-rewrite",
      "access-control-expose-headers": "prefix-if-url-rewrite",
      "access-control-max-age": "prefix-if-url-rewrite",
      "access-control-allow-methods": "prefix-if-url-rewrite",
      "access-control-allow-headers": "prefix-if-url-rewrite",

      "accept-patch": "keep",
      "accept-ranges": "keep",

      age: "prefix",

      allow: "keep",

      "alt-svc": "prefix",
      "cache-control": "prefix",

      connection: "prefix",

      "content-base": "url-rewrite",
      "content-disposition": "keep",
      "content-encoding": "prefix-if-content-rewrite",
      "content-language": "keep",
      "content-length": "content-length",
      "content-location": "url-rewrite",
      "content-md5": "prefix",
      "content-range": "keep",
      "content-security-policy": "prefix",
      "content-security-policy-report-only": "prefix",
      "content-type": "keep",

      date: "keep",

      etag: "prefix",
      expires: "prefix",

      "last-modified": "prefix",
      link: "link",
      location: "url-rewrite",

      p3p: "prefix",
      pragma: "prefix",

      "proxy-authenticate": "keep",

      "public-key-pins": "prefix",
      "retry-after": "prefix",
      server: "prefix",

      "set-cookie": "cookie",

      status: "prefix",

      "strict-transport-security": "prefix",

      trailer: "prefix",
      "transfer-encoding": "transfer-encoding",
      tk: "prefix",

      upgrade: "prefix",
      "upgrade-insecure-requests": "prefix",

      vary: "prefix",

      via: "prefix",

      warning: "prefix",

      "www-authenticate": "keep",

      "x-frame-options": "prefix",
      "x-xss-protection": "prefix",

      // this header may cause a crash in some version of Chrome if not rewritten
      "origin-agent-cluster": "prefix",
    };

    const headerPrefix = "X-Archive-Orig-";

    const new_headers = new Headers();

    // [TODO]
    // eslint-disable-next-line prefer-const
    for (let [key, value] of headers.entries()) {
      const rule = headerRules[key];
      switch (rule) {
        case "keep":
          new_headers.append(key, value);
          break;

        case "url-rewrite":
          if (urlRewrite) {
            // if location and redirect just to change scheme of the responseUrl
            if (key === "location" && this.url !== this.responseUrl) {
              const otherScheme = this.scheme === "http:" ? "https:" : "http:";
              const responseUrlOtherScheme =
                otherScheme + this.responseUrl.slice(this.scheme.length);
              if (value === responseUrlOtherScheme) {
                value = otherScheme + this.url.slice(this.url.indexOf("//"));
              }
            }

            new_headers.append(key, this.rewriteUrl(value));
          } else {
            new_headers.append(key, value);
          }
          break;

        case "prefix-if-content-rewrite":
          if (contentRewrite) {
            new_headers.append(headerPrefix + key, value);
          } else {
            new_headers.append(key, value);
          }
          break;

        case "prefix-if-url-rewrite":
          if (urlRewrite) {
            new_headers.append(headerPrefix + key, value);
          } else {
            new_headers.append(key, value);
          }
          break;

        case "content-length":
          if (value == "0") {
            new_headers.append(key, value);
            continue;
          }

          if (contentRewrite) {
            try {
              if (parseInt(value) >= 0) {
                new_headers.append(key, value);
                continue;
              }
              // [TODO]
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (e) {
              // ignore if content-length is not parsable as number
            }
          }

          new_headers.append(key, value);
          break;

        case "transfer-encoding":
          //todo: mark as needing decoding?
          new_headers.append(headerPrefix + key, value);
          break;

        case "prefix":
          new_headers.append(headerPrefix + key, value);
          break;

        case "cookie":
          //todo
          new_headers.append(key, value);
          break;

        case "link":
          if (urlRewrite && !isAjax) {
            new_headers.append(key, this.rewriteLinkHeader(value));
          } else {
            new_headers.append(key, value);
          }
          break;

        default:
          new_headers.append(key, value);
      }
    }

    return new_headers;
  }

  rewriteLinkHeader(value: string) {
    try {
      const parsed = LinkHeader.parse(value);

      for (const entry of parsed.refs) {
        if (entry.uri) {
          entry.uri = this.rewriteUrl(entry.uri);
        }
      }

      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return parsed.toString();
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      console.warn("Error parsing link header: " + value);
      return value;
    }
  }
}
