"use strict";

import parseLinkHeader from 'parse-link-header';
import formatLinkHeader from 'format-link-header';

import { containsAny, isAjaxRequest } from '../utils.js';

import { decodeResponse } from './decoder';
import { ArchiveResponse } from '../response';

import { rewriteDASH, rewriteHLS } from './rewriteVideo';

import { DomainSpecificRuleSet } from './dsruleset';

import { RxRewriter } from './rxrewriter';
import { JSRewriter } from './jsrewriter';

import { HTMLRewriter } from './html';


// ===========================================================================
const STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/gi;

const IMPORT_REGEX = /(@import\s*[\\"']*)([^)'";]+)([\\"']*\s*;?)/gi;

const NO_WOMBAT_REGEX = /WB_wombat_/g;

//const JSONP_REGEX = /^(?:[ \t]*(?:(?:\/\*[^\*]*\*\/)|(?:\/\/[^\n]+[\n])))*[ \t]*(\w+)\(\{/m;
const JSONP_REGEX = /^(?:\s*(?:(?:\/\*[^\*]*\*\/)|(?:\/\/[^\n]+[\n])))*\s*(\w+)\(\{/;

const JSONP_CALLBACK_REGEX = /[?].*callback=([^&]+)/;

const JSONP_CONTAINS = [
  'callback=jQuery',
  'callback=jsonp',
  '.json?'
];

// JS Rewriters
const jsRules = new DomainSpecificRuleSet(JSRewriter);
const baseRules = new DomainSpecificRuleSet(RxRewriter);


// ===========================================================================
class Rewriter {
  constructor({baseUrl, prefix, responseUrl, workerInsertFunc, headInsertFunc = null,
               urlRewrite = true, contentRewrite = true, decode = true, useBaseRules = false} = {}) {
    this.urlRewrite = urlRewrite;
    this.contentRewrite = contentRewrite;
    this.dsRules = urlRewrite && !useBaseRules ? jsRules : baseRules;
    this.decode = decode;

    this.prefix = prefix || "";
    if (this.prefix && urlRewrite) {
      const parsed = new URL(this.prefix);
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
  }

  getRewriteMode(request, response, url = "", mime = null) {
    if (!mime && response) {
      mime = response.headers.get("Content-Type") || "";
      mime = mime.split(";", 1)[0];
    }

    if (request) {
      switch (request.destination) {
        case "style":
          return "css";

        case "script":
          return containsAny(url, JSONP_CONTAINS) ? "jsonp" : "js";

        case "worker":
          return "js-worker";
      }
    }

    switch (mime) {
      case "text/html":
        return "html";

      case "text/javascript":
      case "application/javascript":
      case "application/x-javascript":
        if (containsAny(url, JSONP_CONTAINS)) {
          return "jsonp";
        }
        return url.endsWith(".json") ? "json" : "js";

      case "application/json":
        return "json";

      case "text/css":
        return "css";

      case "application/x-mpegURL":
      case "application/vnd.apple.mpegurl":
        return "hls";

      case "application/dash+xml":
        return "dash";
    }

    return null;
  }

  async rewrite(response, request) {
    const rewriteMode = this.contentRewrite ? this.getRewriteMode(request, response, this.baseUrl) : null;

    const isAjax = isAjaxRequest(request);

    const urlRewrite = this.urlRewrite && !isAjax;

    const headers = this.rewriteHeaders(response.headers, this.urlRewrite, !!rewriteMode, isAjax);

    const encoding = response.headers.get("content-encoding");
    const te = response.headers.get('transfer-encoding');

    response.headers = headers;

    // attempt to decode only if set
    // eg. data may already be decoded for many stores
    if (this.decode && (encoding || te)) {
      response = await decodeResponse(response, encoding, te, rewriteMode === null);
    }

    let rwFunc = null;

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

    const opts = {response, prefix: this.prefix};

    if (urlRewrite) {
      opts.rewriteUrl = url => this.rewriteUrl(url);
    }

    if (rwFunc) {
      let text = await response.getText();
      text = rwFunc.call(this, text, opts);
      response.setContent(text);
    }

    return response;
  }

  updateBaseUrl(url) {
    // set internal base to full url
    this.baseUrl = new URL(url, this.baseUrl).href;

    // not an absolute url, ensure it has slash
    if (url && this.baseUrl != url) {
      try {
        url = new URL(url).href;
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

  isRewritableUrl(url) {
    const NO_REWRITE_URI_PREFIX = ['#', 'javascript:', 'data:', 'mailto:', 'about:', 'file:', 'blob:', '{'];

    for (let prefix of NO_REWRITE_URI_PREFIX) {
      if (url.startsWith(prefix)) {
        return false;
      }
    }

    return true;
  }

  rewriteUrl(url, forceAbs = false) {
    if (!this.urlRewrite) {
      return url;
    }

    var origUrl = url;

    url = url.trim();

    if (!url || !this.isRewritableUrl(url) || url.startsWith(this.prefix) || url.startsWith(this.relPrefix)) {
      return origUrl;
    }

    if (url.startsWith("http:") || url.startsWith("https:") || url.startsWith("https\\3a/")) {
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
  rewriteHtml(response) {
    const htmlRW = new HTMLRewriter(this);
    return htmlRW.rewrite(response);
  }

  // CSS
  rewriteCSS(text) {
    const rewriter = this;

    function cssStyleReplacer(match, n1, n2, n3, offset, string) {
      n2 = n2.replace(/\s+/g, '');
      return n1 + rewriter.rewriteUrl(n2) + n3;
    };

    return text
      .replace(STYLE_REGEX, cssStyleReplacer)
      .replace(IMPORT_REGEX, cssStyleReplacer)
      .replace(NO_WOMBAT_REGEX, '');
  }

  // JS
  rewriteJS(text, opts) {
    const noUrlProxyRewrite = opts && !opts.rewriteUrl;
    const dsRules = noUrlProxyRewrite ? baseRules : this.dsRules;
    const dsRewriter = dsRules.getRewriter(this.baseUrl);

    // optimize: if default rewriter, only rewrite if contains JS props
    if (dsRewriter === dsRules.defaultRewriter) {
      if (noUrlProxyRewrite) {
        return text;
      }

      const overrideProps = [
        'window',
        'self',
        'document',
        'location',
        'top',
        'parent',
        'frames',
        'opener',
        'this',
        'eval',
        'postMessage'
      ];

      let containsProps = false;

      for (let prop of overrideProps) {
        if (text.indexOf(prop) >= 0) {
          containsProps = true;
          break;
        }
      }

      if (!containsProps) {
        return text;
      }
    }

    return dsRewriter.rewrite(text, opts);
  }

  // JSON
  rewriteJSON(text, opts) {
    text = this.rewriteJSONP(text);

    const dsRewriter = baseRules.getRewriter(this.baseUrl);

    if (dsRewriter !== baseRules.defaultRewriter) {
      return dsRewriter.rewrite(text, opts);
    }

    return text;
  }

  // JSONP
  rewriteJSONP(text) {
    const jsonM = text.match(JSONP_REGEX);
    if (!jsonM) {
      return text;
    }

    const callback = this.baseUrl.match(JSONP_CALLBACK_REGEX);

    // if no callback found, or callback is just '?', not jsonp
    if (!callback || callback[1] === "?") {
      return text;
    }

    return callback[1] + text.slice(text.indexOf(jsonM[1]) + jsonM[1].length);
  }

  //Headers
  rewriteHeaders(headers, urlRewrite, contentRewrite, isAjax) {
    const headerRules = {
      'access-control-allow-origin': 'prefix-if-url-rewrite',
      'access-control-allow-credentials': 'prefix-if-url-rewrite',
      'access-control-expose-headers': 'prefix-if-url-rewrite',
      'access-control-max-age': 'prefix-if-url-rewrite',
      'access-control-allow-methods': 'prefix-if-url-rewrite',
      'access-control-allow-headers': 'prefix-if-url-rewrite',

      'accept-patch': 'keep',
      'accept-ranges': 'keep',

      'age': 'prefix',

      'allow': 'keep',

      'alt-svc': 'prefix',
      'cache-control': 'prefix',

      'connection': 'prefix',

      'content-base': 'url-rewrite',
      'content-disposition': 'keep',
      'content-encoding': 'prefix-if-content-rewrite',
      'content-language': 'keep',
      'content-length': 'content-length',
      'content-location': 'url-rewrite',
      'content-md5': 'prefix',
      'content-range': 'keep',
      'content-security-policy': 'prefix',
      'content-security-policy-report-only': 'prefix',
      'content-type': 'keep',

      'date': 'keep',

      'etag': 'prefix',
      'expires': 'prefix',

      'last-modified': 'prefix',
      'link': 'link',
      'location': 'url-rewrite',

      'p3p': 'prefix',
      'pragma': 'prefix',

      'proxy-authenticate': 'keep',

      'public-key-pins': 'prefix',
      'retry-after': 'prefix',
      'server': 'prefix',

      'set-cookie': 'cookie',

      'status': 'prefix',

      'strict-transport-security': 'prefix',

      'trailer': 'prefix',
      'transfer-encoding': 'transfer-encoding',
      'tk': 'prefix',

      'upgrade': 'prefix',
      'upgrade-insecure-requests': 'prefix',

      'vary': 'prefix',

      'via': 'prefix',

      'warning': 'prefix',

      'www-authenticate': 'keep',

      'x-frame-options': 'prefix',
      'x-xss-protection': 'prefix',
    }

    const headerPrefix = 'X-Archive-Orig-';

    let new_headers = new Headers();

    for (let header of headers.entries()) {
      const rule = headerRules[header[0]];

      switch (rule) {
        case "keep":
          new_headers.append(header[0], header[1]);
          break;

        case "url-rewrite":
          if (urlRewrite) {
            new_headers.append(header[0], this.rewriteUrl(header[1]));
          } else {
            new_headers.append(header[0], header[1]);
          }
          break;

        case "prefix-if-content-rewrite":
          if (contentRewrite) {
            new_headers.append(headerPrefix + header[0], header[1]);
          } else {
            new_headers.append(header[0], header[1]);
          }
          break;

        case "prefix-if-url-rewrite":
          if (urlRewrite) {
            new_headers.append(headerPrefix + header[0], header[1]);
          } else {
            new_headers.append(header[0], header[1]);
          }
          break;

        case "content-length":
          if (header[1] == '0') {
            new_headers.append(header[0], header[1]);
            continue;
          }

          if (contentRewrite) {
            try {
              if (parseInt(header[1]) >= 0) {
                new_headers.append(header[0], header[1]);
                continue;
              }
            } catch (e) { }
          }

          new_headers.append(header[0], header[1]);
          break;

        case "transfer-encoding":
          //todo: mark as needing decoding?
          new_headers.append(headerPrefix + header[0], header[1]);
          break;

        case "prefix":
          new_headers.append(headerPrefix + header[0], header[1]);
          break;

        case "cookie":
          //todo
          new_headers.append(header[0], header[1]);
          break;

        case "link":
          if (urlRewrite && !isAjax) {
            const parsed = parseLinkHeader(header[1]);

            for (const entry of Object.values(parsed)) {
              if (entry.url) {
                entry.url = this.rewriteUrl(entry.url);
              }
            }

            new_headers.append(header[0], formatLinkHeader(parsed));
          } else {
            new_headers.append(header[0], header[1]);
          }
          break;

        default:
          new_headers.append(header[0], header[1]);
      }
    }

    return new_headers;
  }
}

export { Rewriter, ArchiveResponse, baseRules, jsRules };

