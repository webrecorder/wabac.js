"use strict";

import { PassThrough } from 'stream';

import RewritingStream from 'parse5-html-rewriting-stream';

import { startsWithAny, containsAny, isAjaxRequest } from '../utils.js';

import { decodeResponse } from './decoder';
import { ArchiveResponse } from '../response';

import { rewriteDASH, rewriteHLS } from './rewriteVideo';

import { DomainSpecificRuleSet } from './dsruleset';

import { RxRewriter } from './rxrewriter';
import { JSRewriter } from './jsrewriter';

// ===========================================================================
const STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/gi;

const IMPORT_REGEX = /(@import\s*[\\"']*)([^)'";]+)([\\"']*\s*;?)/gi;

const META_REFRESH_REGEX = /([\d.]+\s*;\s*url\s*=\s*)(.+)(\s*)/mi;

const NO_WOMBAT_REGEX = /WB_wombat_/g;

//const JSONP_REGEX = /^(?:[ \t]*(?:(?:\/\*[^\*]*\*\/)|(?:\/\/[^\n]+[\n])))*[ \t]*(\w+)\(\{/m;
const JSONP_REGEX = /^(?:\s*(?:(?:\/\*[^\*]*\*\/)|(?:\/\/[^\n]+[\n])))*\s*(\w+)\(\{/;

const JSONP_CALLBACK_REGEX = /[?].*callback=([^&]+)/;

const JSONP_CONTAINS = [
  'callback=jQuery',
  'callback=jsonp',
  '.json?'
];

const DATA_RW_PROTOCOLS = ["http://", "https://", "//"];

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

    const urlRewrite = this.urlRewrite && !isAjaxRequest(request);

    const headers = this.rewriteHeaders(response.headers, this.urlRewrite, !!rewriteMode);

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

    const opts = {response};

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

  normalizeBaseUrl(url, absUrl) {
    // not an absolute url, ensure it has slash
    if (url && absUrl != url) {
      try {
        return new URL(url).href;
      } catch (e) {
        if (url.startsWith("//")) {
          url = new URL("https:" + url).href;
          return url.slice("https:".length);
        }
      }
    }

    return url;
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
  rewriteMetaContent(attrs, attr) {
    let equiv = this.getAttr(attrs, "http-equiv");
    if (equiv) {
      equiv = equiv.toLowerCase();
    }

    if (equiv === "content-security-policy") {
      attr.name = "_" + attr.name;
    } else if (equiv === "refresh") {
      return attr.value.replace(META_REFRESH_REGEX, (m, p1, p2, p3) => p1 + this.rewriteUrl(p2) + p3);
    } else if (this.getAttr(attrs, "name") === "referrer") {
      return "no-referrer-when-downgrade";
    } else if (startsWithAny(attr.value, DATA_RW_PROTOCOLS)) {
      return this.rewriteUrl(attr.value);
    }

    return attr.value;
  }

  rewriteSrcSet(value) {
    const SRCSET_REGEX = /\s*(\S*\s+[\d\.]+[wx]),|(?:\s*,(?:\s+|(?=https?:)))/;

    let rv = [];

    for (let v of value.split(SRCSET_REGEX)) {
      if (v) {
        const parts = v.trim().split(" ");
        parts[0] = this.rewriteUrl(parts[0]);
        rv.push(parts.join(" "));
      }
    }

    return rv.join(", ");
  }


  rewriteTagAndAttrs(tag, attrRules) {
    const OBJECT_FLASH_DATA_RX = [{
      "match": /youtube.com\/v\/([^&]+)[&]/,
      "replace": "youtube.com/embed/$1?"
    }]


    const isUrl = (val) => { return startsWithAny(val, DATA_RW_PROTOCOLS); }

    for (let attr of tag.attrs) {
      const name = attr.name;
      const value = attr.value;

      // js attrs
      if (name.startsWith("on") && value.startsWith("javascript:") && name.slice(2, 3) != "-") {
        attr.value = "javascript:" + this.rewriteJS(value.slice("javascript:".length), {inline: true});
      }
      // css attrs
      else if (name === "style") {
        attr.value = this.rewriteCSS(attr.value);
      }

      // background attr
      else if (name === "background") {
        attr.value = this.rewriteUrl(value);
      }

      else if (name === "srcset") {
        attr.value = this.rewriteSrcSet(value);
      }

      else if (name === "crossorigin" || name === "integrity") {
        attr.name = "_" + attr.name;
      }

      else if (tag.tagName === "meta" && name === "content") {
        attr.value = this.rewriteMetaContent(tag.attrs, attr);
      }

      else if (tag.tagName === "param" && isUrl(value)) {
        attr.value = this.rewriteUrl(attr.value);
      }

      else if (name.startsWith("data-") && isUrl(value)) {
        attr.value = this.rewriteUrl(attr.value);
      }

      else if (tag.tagName === "base" && name === "href") {
        try {

          // set internal base to full url
          this.baseUrl = new URL(attr.value, this.baseUrl).href;

          // rewrite url, keeping relativeness intact
          attr.value = this.rewriteUrl(this.normalizeBaseUrl(attr.value, this.baseUrl));
        } catch (e) {
          console.warn("Invalid <base>: " + attr.value);
        }
      }

      else if (tag.tagName === "script" && name === "src") {
        const newValue = this.rewriteUrl(attr.value);
        if (newValue === attr.value) {// && this.isRewritableUrl(newValue)) {
          tag.attrs.push({"name": "__wb_orig_src", "value": attr.value});
          attr.value = this.rewriteUrl(attr.value, true);
        } else {
          attr.value = newValue;
        }
      }

      else if (tag.tagName === "object" && name === "data") {
        const type = this.getAttr(tag.attrs, "type");

        // convert object tag to iframe
        if (type === "application/pdf") {
          attr.name = "src";
          tag.tagName = "iframe";
        } else if (type === "application/x-shockwave-flash") {
          for (const rule of OBJECT_FLASH_DATA_RX) {
            const value = attr.value.replace(rule.match, rule.replace);
            if (value !== attr.value) {
              attr.name = "src";
              attr.value = this.rewriteUrl(value);
              tag.tagName = "iframe";
              break;
            }
          }
        }
      }

      else if (name === "href" || name === "src") {
        attr.value = this.rewriteUrl(attr.value);
      }

      else {
        if (attrRules[attr.name]) {
          attr.value = this.rewriteUrl(attr.value);
        }
      }
    }
  }

  getAttr(attrs, name) {
    for (let attr of attrs) {
      if (attr.name === name) {
        return attr.value;
      }
    }

    return null;
  }

  async rewriteHtml(response) {
    if (!response.buffer && !response.reader) {
      //console.warn("Missing response body for: " + response.url);
      return response;
    }

    const defmod = "mp_";

    const rewriteTags = {
      'a': { 'href': defmod },
      'base': { 'href': defmod },
      'applet': {
        'codebase': 'oe_',
        'archive': 'oe_'
      },
      'area': { 'href': defmod },
      'audio': { 'src': 'oe_' },
      'base': { 'href': defmod },
      'blockquote': { 'cite': defmod },
      'body': { 'background': 'im_' },
      'button': { 'formaction': defmod },
      'command': { 'icon': 'im_' },
      'del': { 'cite': defmod },
      'embed': { 'src': 'oe_' },
      'iframe': { 'src': 'if_' },
      'image': { 'src': 'im_', 'xlink:href': 'im_', 'href': 'im_' },
      'img': {
        'src': 'im_',
        'srcset': 'im_'
      },
      'ins': { 'cite': defmod },
      'input': {
        'src': 'im_',
        'formaction': defmod
      },
      'form': { 'action': defmod },
      'frame': { 'src': 'fr_' },
      'link': { 'href': 'oe_' },
      'meta': { 'content': defmod },
      'object': {
        'codebase': 'oe_',
        'data': 'oe_'
      },
      'param': { 'value': 'oe_' },
      'q': { 'cite': defmod },
      'ref': { 'href': 'oe_' },
      'script': { 'src': 'js_', 'xlink:href': 'js_' },
      'source': { 'src': 'oe_', 'srcset': 'oe_' },
      'video': {
        'src': 'oe_',
        'poster': 'im_'
      },
    }

    const rwStream = new RewritingStream();

    let insertAdded = false;
    let hasData = false;

    let context = "";
    let scriptRw = false;
    let replaceTag = null;

    let cacheChunks = [];
    let cacheOffset = 0;

    function getRawText(loc) {
      let offset = cacheOffset;

      while (cacheChunks.length) {
        const nextOffset = offset + cacheChunks[0].byteLength;
        if (loc.startOffset > nextOffset) {
          cacheChunks.shift();
          offset = nextOffset;
        } else {
          break;
        }
      }

      if (!cacheChunks.length) {
        return "";
      }

      cacheOffset = offset;
      offset = loc.startOffset - offset;

      let remainder = loc.endOffset - loc.startOffset;
      const textDec = new TextDecoder();
      let text = "";

      for (const chunk of cacheChunks) {
        if (remainder <= 0) {
          break;
        }

        const slice =  chunk.slice(offset, offset + remainder);
        offset = 0;
        remainder -= slice.byteLength;
        text += textDec.decode(slice);
      }

      return text;
    }

    const addInsert = () => {
      if (!insertAdded && hasData && this.headInsertFunc) {
        const headInsert = this.headInsertFunc(this.url);
        if (headInsert) {
          rwStream.emitRaw(headInsert);
        }
        insertAdded = true;
      }
    };

    rwStream.on('startTag', startTag => {

      const tagRules = rewriteTags[startTag.tagName];

      const original = startTag.tagName;

      this.rewriteTagAndAttrs(startTag, tagRules || {});

      if (!insertAdded && !["head", "html"].includes(startTag.tagName)) {
        hasData = true;
        addInsert();
      }

      rwStream.emitStartTag(startTag);

      switch (startTag.tagName) {
        case "script":
          if (startTag.selfClosing) {
            break;
          }

          context = startTag.tagName;

          const scriptType = this.getAttr(startTag.attrs, "type");

          scriptRw = !scriptType || (scriptType.indexOf("javascript") >= 0 || scriptType.indexOf("ecmascript") >= 0);
          break;

        case "style":
          if (!startTag.selfClosing) {
            context = startTag.tagName;
          }
          break;
      }

      if (startTag.tagName !== original) {
        context = original;
        replaceTag = startTag.tagName;
      }
    });

    rwStream.on('endTag', endTag => {
      if (endTag.tagName === context) {
        if (replaceTag) {
          endTag.tagName = replaceTag;
          replaceTag = null;
        }
        context = "";
      }
      rwStream.emitEndTag(endTag);
    });

    rwStream.on('text', (textToken, raw) => {
      if (context === "script") {
        rwStream.emitRaw(scriptRw ? this.rewriteJS(textToken.text) : textToken.text);
      } else if (context === "style") {
        rwStream.emitRaw(this.rewriteCSS(textToken.text));
      } else {
        // if initial offset is <0, then raw text was cutoff, so use our own tracked buffer
        if ((textToken.sourceCodeLocation.startOffset - rwStream.posTracker.droppedBufferSize) < 0) {
          raw = getRawText(textToken.sourceCodeLocation);
        }
        rwStream.emitRaw(raw);
      }
    });

    const buff = new PassThrough({ encoding: 'utf-8' });
    buff.pipe(rwStream);
    buff.on('end', addInsert);

    const encoder = new TextEncoder("utf-8");

    const rs = new ReadableStream({
      async start(controller) {
        rwStream.on("data", (chunk) => controller.enqueue(encoder.encode(chunk)));
        rwStream.on("end", () => controller.close());

        for await (const chunk of response) {
          cacheChunks.push(chunk);
          buff.push(chunk);
          hasData = true;
        }

        buff.push(null);
      }
    });

    response.setContent(rs);
    return response;
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
  rewriteHeaders(headers, urlRewrite, contentRewrite) {
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
      'link': 'prefix',
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

        default:
          new_headers.append(header[0], header[1]);
      }
    }

    return new_headers;
  }
}

export { Rewriter, ArchiveResponse, baseRules, jsRules };

