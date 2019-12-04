import brotliDecode from 'brotli/decompress';
import { Inflate } from 'pako';

import { Readable } from 'stream';

import RewritingStream from 'parse5-html-rewriting-stream';

import XMLParser from 'fast-xml-parser';

import { makeRwResponse, startsWithAny, isAjaxRequest } from './utils.js';

const STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/gi;

const IMPORT_REGEX = /(@import\s*[\\"']*)([^)'";]+)([\\"']*\s*;?)/gi;

const NO_WOMBAT_REGEX = /WB_wombat_/g;

const JSONP_REGEX = /(?:^[ \t]*(?:(?:\/\*[^\*]*\*\/)|(?:\/\/[^\n]+[\n])))*[ \t]*(\w+)\(\{/m;

const JSONP_CALLBACK_REGEX = /[?].*callback=([^&]+)/;

const DOT_POST_MSG_REGEX = /(.postMessage\s*\()/;

const DATA_RW_PROTOCOLS = ["http://", "https://", "//"];


class Rewriter {
  constructor(baseUrl, prefix, headInsertFunc = null) {
    this.baseUrl = baseUrl;
    this.prefix = prefix || "";
    this.relPrefix = new URL(this.prefix).pathname;
    this.headInsertFunc = headInsertFunc;
  }

  dechunkArrayBuffer(data) {
    let readOffset = 0;
    let writeOffset = 0;

    const decoder = new TextDecoder("utf-8");

    while(readOffset < data.length) {
      let i = readOffset;

      // check hex digits, 0-9, A-Z, a-z
      while ((data[i] >= 48 && data[i] <= 57) ||
             (data[i] >= 65 && data[i] <= 70) ||
             (data[i] >= 97 && data[i] <= 102)) {
        i++;
      }

      // doesn't start with number, return original
      if (i === 0) {
        return data;
      }

      // ensure \r\n\r\n
      if (data[i] != 13 || data[i + 1] != 10) {
        return data;
      }

      i += 2;

      var chunkLength = parseInt(decoder.decode(data.subarray(readOffset, i)), 16);

      if (chunkLength == 0) {
        break;
      }

      data.set(data.subarray(i, i + chunkLength), writeOffset);

      i += chunkLength;

      writeOffset += chunkLength;

      if (data[i] == 13 && data[i + 1] == 10) {
        i += 2;
      }

      readOffset = i;
    }

    return data.subarray(0, writeOffset);
  }

  async decodeResponse(response, encoding, chunked) {
    let content = new Uint8Array(await response.arrayBuffer());

    if (chunked) {
      content = this.dechunkArrayBuffer(content);
    }

    if (encoding === "br") {
      content = brotliDecode(content);

    } else if (encoding === "gzip") {
      const inflator = new Inflate();

      inflator.push(content, true);

      // if error occurs (eg. not gzip), use original arraybuffer
      content = (inflator.result && !inflator.err) ? inflator.result : content;
    }

    return makeRwResponse(content, response);
  }

  getRewriteMode(request, response) {
    const requestType = request.destination;
    const baseUrl = this.baseUrl;

    let contentType = response.headers.get("Content-Type") || "";
    contentType = contentType.split(";", 1)[0];

    const isAjax = isAjaxRequest(request);

    switch (requestType) {
      case "style":
        return "css";

      case "script":
        return !isAjax ? "js" : null;
    }

    switch (contentType) {
      case "text/html":
        return !isAjax ? "html" : null;

      case "text/javascript":
      case "application/javascript":
      case "application/x-javascript":
        if (isAjax) {
          return null;
        }

        return this.baseUrl.endsWith(".json") ? "json" : "js";

      case "application/json":
        return !isAjax ? "json" : null;

      case "text/css":
        return "css";

      case "application/x-mpegURL":
      case "application/vnd.apple.mpegurl":
        return "hls";
    }

    return null;
  }

  async rewrite(response, request, csp, noRewrite = false) {
    const rewriteMode = noRewrite ? null : this.getRewriteMode(request, response);

    const encoding = response.headers.get("content-encoding");

    const headers = this.rewriteHeaders(response.headers, !noRewrite, rewriteMode !== null);

    if (csp) {
      headers.append("Content-Security-Policy", csp);
    }

    const te = response.headers.get('transfer-encoding');

    if (encoding || te) {
      response = await this.decodeResponse(response, encoding, te === 'chunked');
    }

    let rwFunc = null;

    switch (rewriteMode) {
      case "html":
        return this.rewriteHtml(response, headers);

      case "css":
        rwFunc = this.rewriteCSS;
        break;

      case "js":
        rwFunc = this.rewriteJS;
        break;

      case "json":
        rwFunc = this.rewriteJSONP;
        break;

      case "hls":
        rwFunc = this.rewriteHLS;
        break;
    }

    let content = null;

    if (rwFunc) {
      const text = await response.text();
      content = rwFunc.call(this, text);
    } else {
      content = response.body;
    }

    return makeRwResponse(content, response, headers);
  }

  // URL
  rewriteUrl(url) {
    var origUrl = url;

    url = url.trim();

    if (!url) {
      return origUrl;
    }

    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) {
      return origUrl;
    }

    if (url.startsWith("http:") || url.startsWith("https:") || url.startsWith("//")) {
      return this.prefix + url;
    }

    if (url.startsWith("/")) {
      url = new URL(url, this.baseUrl).href;
      return this.relPrefix + url;
    } else if (url.startsWith(".")) {
      url = new URL(url, this.baseUrl).href;
      return this.prefix + url;
    } else {
      return origUrl;
    }

    //console.log(`RW ${origUrl} -> ${this.prefix + url}`);

  }

  // HTML
  rewriteMetaContent(attrs, attr) {
    const equiv = this.getAttr(attrs, "http-equiv");

    if (equiv === "content-security-policy") {
      attr.name = "_" + attr.name;
    } else if (equiv === "refresh") {
      //todo: refresh
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
        rv.push(this.rewriteUrl(v.trim()));
      }
    }

    return rv.join(", ");
  }


  rewriteAttrs(tag, attrRules) {
    const isUrl = (val) => { return startsWithAny(val, DATA_RW_PROTOCOLS); }

    for (let attr of tag.attrs) {
      const name = attr.name;
      const value = attr.value;

      // js attrs
      if (name.startsWith("on") && value.startsWith("javascript:") && name.slice(2, 3) != "-") {
        attr.value = "javascript:" + this.rewriteJS(value.slice("javascript:".length), true);
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

  rewriteHtml(response, headers) {
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

    const addInsert = () => {
      if (!insertAdded && hasData && this.headInsertFunc) {
        const headInsert = this.headInsertFunc();
        if (headInsert) {
          rwStream.emitRaw(headInsert);
        }
        insertAdded = true;
      }
    };

    // Replace divs with spans
    rwStream.on('startTag', startTag => {

      const tagRules = rewriteTags[startTag.tagName];

      this.rewriteAttrs(startTag, tagRules || {});

      if (!insertAdded && !["head", "html"].includes(startTag.tagName)) {
        hasData = true;
        addInsert();
      }

      rwStream.emitStartTag(startTag);

      switch (startTag.tagName) {
        case "base":
          const newBase = this.getAttr(startTag.attrs, "href");
          if (newBase && newBase.startsWith(this.prefix)) {
            this.baseUrl = newBase.slice(this.prefix.length);
          }
          break;

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
    });

    rwStream.on('endTag', endTag => {
      if (endTag.tagName == context) {
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
        rwStream.emitText(textToken);
      }
    });

    const buff = new Readable({ encoding: 'utf-8' });
    buff._read = () => { };
    buff.pipe(rwStream);
    buff.on('end', addInsert);

    const reader = response.body.getReader();

    function pump() {
      return reader.read().then(({ done, value }) => {
        // When no more data needs to be consumed, close the stream

        if (done) {
          buff.push(null);
          return;
        }

        // Enqueue the next data chunk into our target stream
        //rewriter.write(value, 'utf-8');
        buff.push(value);
        hasData = hasData || !!value.length;
        return pump();
      });
    }

    var encoder = new TextEncoder("utf-8");

    var rs = new ReadableStream({
      start(controller) {
        rwStream.on("data", function (chunk) {
          controller.enqueue(encoder.encode(chunk));
        });

        rwStream.on("end", function () {
          controller.close();
        });

        pump();
      }
    });

    return makeRwResponse(rs, response, headers);
  }

  // Generic Response
  rewriteResponse(response, headers, rewriteFunc) {
    return response.text().then((text) => {
      //return rewriteFunc.call(this, text);
      return makeRwResponse(rewriteFunc.call(this, text), response, headers);

    });
  }

  // CSS
  cssStyleReplacer(match, n1, n2, n3, offset, string) {
    return n1 + this.rewriteUrl(n2) + n3;
  };

  rewriteCSS(text) {
    return text
      .replace(STYLE_REGEX, this.cssStyleReplacer.bind(this))
      .replace(IMPORT_REGEX, this.cssStyleReplacer.bind(this))
      .replace(NO_WOMBAT_REGEX, '');
  }

  // JS
  rewriteJS(text, inline) {
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

    if (this.baseUrl.indexOf("youtube.com") > 0) {
      return new JSRewriterRules(youtubeRules).rewrite(text, inline);
    }

    if (this.baseUrl.indexOf("facebook.com") > 0) {
      return new JSRewriterRules(makeFBRules(this)).rewrite(text, inline);
    }

    return jsRules.rewrite(text, inline);
  }

  //JSONP
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

    return callback[1] + text.slice(text.indexOf(josnM[1]) + jsonM[1].length);
  }

  //HLS
  rewriteHLS(text) {
    const EXT_INF = /#EXT-X-STREAM-INF:(?:.*[,])?BANDWIDTH=([\d]+)/;
    const EXT_RESOLUTION = /RESOLUTION=([\d]+)x([\d]+)/;

    const maxRes = 0;
    const maxBand = 1000000000;

    let indexes = [];
    let count = 0;
    let bestIndex = null;

    let bestBand = 0;
    let bestRes = 0;

    let lines = text.trimEnd().split('\n');

    for (let line of lines) {
      const m = line.match(EXT_INF);
      if (!m) {
        count += 1;
        continue;
      }

      indexes.push(count);

      const currBand = Number(m[1]);

      const m2 = line.match(EXT_RESOLUTION);
      const currRes = m2 ? Number(m2[1]) * Number(m2[2]) : 0;

      if (maxRes && currRes) {
        if (currRes > bestRes && currRes < maxRes) {
          bestRes = currRes;
          bestBand = currBand;
          bestIndex = count;
        }
      } else if (currBand > bestBand && currBand <= maxBand) {
        bestRes = currRes;
        bestBand = currBand;
        bestIndex = count;
      }

      count += 1;
    }

    indexes.reverse();

    for (let inx of indexes) {
      if (inx !== bestIndex) {
        lines.splice(inx, 2);
      }
    }

    return lines.join('\n');
  }

  // DASH
  rewriteDash(text, bestIds) {
    const options = {ignoreAttributes: false, ignoreNameSpace: false};
    const root = XMLParser.parse(text, options);

    //console.log(util.inspect(root, {depth: null}));

    const maxRes = 0;
    const maxBand = 1000000000;

    let best = null;
    let bestRes = 0;
    let bestBand = 0;

    for (let adaptset of root.MPD.Period.AdaptationSet) {
      //console.log(adaptset);

      best = null;
      bestRes = 0;
      bestBand = 0;

      if (!Array.isArray(adaptset.Representation)) {
        if (Array.isArray(bestIds) && typeof(adaptset.Representation) === 'object' && adaptset.Representation["@_id"]) {
          bestIds.push(adaptset.Representation["@_id"]);
        }
        continue;
      }

      for (let repres of adaptset.Representation) {
        const currRes = Number(repres['@_width'] || '0') * Number(repres['@_height'] || '0');
        const currBand = Number(repres['@_bandwidth'] || '0');

        if (currRes && maxRes) {
          if (currRes <= maxRes && currRes > bestRes) {
              bestRes = currRes;
              bestBand = currBand;
              best = repres;
          }
        } else if (currBand <= maxBand && currBand > bestBand) {
          bestRes = currRes;
          bestBand = currBand;
          best = repres;
        }
      }

      if (best && Array.isArray(bestIds)) {
        bestIds.push(best['@_id']);
      }

      if (best) {
        adaptset.Representation = [best];
      }
    }

    const toXML = new XMLParser.j2xParser(options);
    const xml = toXML.parse(root);

    return "<?xml version='1.0' encoding='UTF-8'?>\n" + xml.trim();
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
      'link': 'keep',
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

class JSRewriterRules {
  constructor(extraRules) {
    this.thisRw = '_____WB$wombat$check$this$function_____(this)';

    const checkLoc = '((self.__WB_check_loc && self.__WB_check_loc(location)) || {}).href = ';

    const localObjs = [
      'window',
      'self',
      'document',
      'location',
      'top',
      'parent',
      'frames',
      'opener'
    ];

    const propStr = localObjs.join('|');

    const evalStr = 'WB_wombat_runEval(function _____evalIsEvil(_______eval_arg$$) { return eval(_______eval_arg$$); }.bind(this)).';


    this.rules = [
      // rewriting 'eval(....)' - invocation
      [/[^$]\beval\s*\(/, this.addPrefixAfter1(evalStr)],

      // rewriting 'x = eval' - no invocation
      [/[^$]\beval\b/, this.addPrefixAfter1('WB_wombat_')],

      // rewriting .postMessage -> __WB_pmw(self).postMessage
      [/\.postMessage\b\(/, this.addPrefix('.__WB_pmw(self)')],

      // rewriting 'location = ' to custom expression '(...).href =' assignment
      [/[^$.]\s*\blocation\b\s*[=]\s*(?![=])/, this.addSuffix(checkLoc)],

      // rewriting 'return this'
      [/\breturn\s+this\b\s*(?![.$])/, this.replaceThis()],

      // rewriting 'this.' special properties access on new line, with ; prepended
      // if prev char is '\n', or if prev is not '.' or '$', no semi
      [new RegExp(`[^$.]\\s*\\bthis\\b(?=(?:\\.(?:${propStr})\\b))`), this.replaceThisProp()],

      // rewrite '= this' or ', this'
      [/[=,]\s*\bthis\b\s*(?![.$])/, this.replaceThis()],

      // rewrite '})(this)'
      [/\}(?:\s*\))?\s*\(this\)/, this.replaceThis()],

      // rewrite this in && or || expr?
      [/[^|&][|&]{2}\s*this\b\s*(?![|&.$](?:[^|&]|$))/, this.replaceThis()],
    ];

    if (extraRules) {
      this.rules = this.rules.concat(extraRules);
    }

    this.compileRules();

    this.firstBuff = this.initLocalDecl(localObjs);
    this.lastBuff = '\n\n}';
  }

  compileRules() {
    let rxBuff = '';

    for (let rule of this.rules) {
      if (rxBuff) {
        rxBuff += "|";
      }
      rxBuff += `(${rule[0].source})`;
    }

    const rxString = `(?:${rxBuff})`;

    //console.log(rxString);

    this.rx = new RegExp(rxString, 'gm');
  }

  doReplace(params) {
    const offset = params[params.length - 2];
    const string = params[params.length - 1];

    for (let i = 0; i < this.rules.length; i++) {
      const curr = params[i];
      if (!curr) {
        continue;
      }

      // if (this.rules[i].length == 3) {
      //  const lookbehind = this.rules[i][2];
      //  const offset = params[params.length - 2];
      //  const string = params[params.length - 1];

      //  const len = lookbehind.len || 1;
      //  const behind = string.slice(offset - len, offset);

      //  // if lookbehind check does not pass, don't replace!
      //  if (!behind.match(lookbehind.rx) !== (lookbehind.neg || false)) {
      //      return curr;
      //  }
      // }

      const result = this.rules[i][1].call(this, curr, offset, string);
      if (result) {
        return result;
      }
    }
  }

  addPrefix(prefix) {
    return x => prefix + x;
  }

  addPrefixAfter1(prefix) {
    return x => x[0] + prefix + x.slice(1);
  }

  addSuffix(suffix) {
    return (x, offset, string) => {
      if (offset > 0) {
        const prev = string[offset - 1];
        if (prev === '.' || prev === '$') {
          return x;
        }
      }
      return x + suffix;
    }
  }

  replaceThis() {
    return x => x.replace('this', this.thisRw);
  }

  replaceThisProp() {
    return (x, offset, string) => {
      const prev = (offset > 0 ? string[offset - 1] : "");
      if (prev === '\n') {
        return x.replace('this', ';' + this.thisRw);
      } else if (prev !== '.' && prev !== '$') {
        return x.replace('this', this.thisRw);
      } else {
        return x;
      }
    };
  }

  initLocalDecl(localDecls) {
    const assignFunc = '_____WB$wombat$assign$function_____';
    
    let buffer = `\
    var ${assignFunc} = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
    if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
    {\
    `;

    for (let decl of localDecls) {
      buffer += `let ${decl} = ${assignFunc}("${decl}");\n`;
    }

    return buffer + '\n';
  }

  rewrite(text, inline) {
    let newText = text.replace(this.rx, (match, ...params) => this.doReplace(params));
    newText = this.firstBuff + newText + this.lastBuff;
    return inline ? newText.replace(/\n/g, " ") : newText;
  }
}

const jsRules = new JSRewriterRules();

function ruleReplace(string) {
  return x => string.replace('{0}', x);
}

const youtubeRules = [
  [/ytplayer.load\(\);/, ruleReplace('ytplayer.config.args.dash = "0"; ytplayer.config.args.dashmpd = ""; {0}')],
  [/yt\.setConfig.*PLAYER_CONFIG.*args":\s*{/, ruleReplace('{0} "dash": "0", dashmpd: "", ')],
  [/"player":.*"args":{/, ruleReplace('{0}"dash":"0","dashmpd":"",')],
];



function makeFBRules(rewriter) {
  function rewriteFBDash(string) {
    let dashManifest = null;

    try {
      dashManifest = JSON.parse(string.match(/dash_manifest":(".*"),"dash/)[1]);
    } catch (e) {
      return;
    }

    let bestIds = [];

    const newDashManifest = rewriter.rewriteDash(dashManifest, bestIds) + "\n";

    const resultJSON = {"dash_manifest": newDashManifest, "dash_prefetched_representation_ids": bestIds};   

    const result = JSON.stringify(resultJSON).replace(/</g, "\\u003C").slice(1, -1);

    return result;
  }

  const FBRules = [
    [/"dash_manifest":".*dash_prefetched_representation_ids":.*?\]/, rewriteFBDash]
  ];

  return FBRules;
}


export { Rewriter };

