import { RewritingStream } from "parse5-html-rewriting-stream";

import { startsWithAny, decodeLatin1, encodeLatin1, MAX_STREAM_CHUNK_SIZE, REPLAY_TOP_FRAME_NAME } from "../utils.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();


// ===========================================================================
const META_REFRESH_REGEX = /([\d.]+\s*;\s*url\s*=\s*)(.+)(\s*)/mi;

const DATA_RW_PROTOCOLS = ["http://", "https://", "//"];

const defmod = "mp_";

const MAX_HTML_REWRITE_SIZE = 5000000;

const rewriteTags = {
  "a": { "href": defmod },
  "applet": {
    "codebase": "oe_",
    "archive": "oe_"
  },
  "area": { "href": defmod },
  "audio": { "src": "oe_" },
  "base": { "href": defmod },
  "blockquote": { "cite": defmod },
  "body": { "background": "im_" },
  "button": { "formaction": defmod },
  "command": { "icon": "im_" },
  "del": { "cite": defmod },
  "embed": { "src": "oe_" },
  "iframe": { "src": "if_" },
  "image": { "src": "im_", "xlink:href": "im_", "href": "im_" },
  "img": {
    "src": "im_",
    "srcset": "im_"
  },
  "ins": { "cite": defmod },
  "input": {
    "src": "im_",
    "formaction": defmod
  },
  "form": { "action": defmod },
  "frame": { "src": "fr_" },
  "link": { "href": "oe_" },
  "meta": { "content": defmod },
  "object": {
    "codebase": "oe_",
    "data": "oe_"
  },
  "param": { "value": "oe_" },
  "q": { "cite": defmod },
  "ref": { "href": "oe_" },
  "script": { "src": "js_", "xlink:href": "js_" },
  "source": { "src": "oe_", "srcset": "oe_" },
  "video": {
    "src": "oe_",
    "poster": "im_"
  },
};

const OBJECT_FLASH_DATA_RX = [{
  "match": /youtube.com\/v\/([^&]+)[&]/,
  "replace": "youtube.com/embed/$1?"
}];


const TEXT_NODE_REWRITE_RULES = [
  {
    urlMatch: /[?&]:loadOrderID=([\d]+)/,
    match: /(loadOrderID&(quot;&)?#x[^;]+?;)([\d]+)/gi,
    replace: "$1$U1"
  }
];


// ===========================================================================
class HTMLRewriter
{
  constructor(rewriter, isCharsetUTF8 = false) {
    this.rewriter = rewriter;
    this.rule = null;

    for (const rule of TEXT_NODE_REWRITE_RULES) {
      const m = this.rewriter.url.match(rule.urlMatch);
      if (m) {
        this.ruleMatch = m;
        this.rule = rule;
        break;
      }
    }

    this.isCharsetUTF8 = isCharsetUTF8;
  }

  rewriteMetaContent(attrs, attr, rewriter) {
    let equiv = this.getAttr(attrs, "http-equiv");
    if (equiv) {
      equiv = equiv.toLowerCase();
    }

    if (equiv === "content-security-policy") {
      attr.name = "_" + attr.name;
    } else if (equiv === "refresh") {
      return attr.value.replace(META_REFRESH_REGEX, (m, p1, p2, p3) => p1 + this.rewriteUrl(rewriter, p2) + p3);
    } else if (this.getAttr(attrs, "name") === "referrer") {
      return "no-referrer-when-downgrade";
    } else if (startsWithAny(attr.value, DATA_RW_PROTOCOLS)) {
      return this.rewriteUrl(rewriter, attr.value);
    }

    return attr.value;
  }

  rewriteSrcSet(value, rewriter) {
    const SRCSET_REGEX = /\s*(\S*\s+[\d.]+[wx]),|(?:\s*,(?:\s+|(?=https?:)))/;

    let rv = [];

    for (let v of value.split(SRCSET_REGEX)) {
      if (v) {
        const parts = v.trim().split(" ");
        parts[0] = this.rewriteUrl(rewriter, parts[0]);
        rv.push(parts.join(" "));
      }
    }

    return rv.join(", ");
  }

  rewriteTagAndAttrs(tag, attrRules, rewriter) {
    const isUrl = (val) => { return startsWithAny(val, DATA_RW_PROTOCOLS); };
    const tagName = tag.tagName;

    for (let attr of tag.attrs) {
      const name = attr.name;
      const value = attr.value;

      // js attrs
      if (name.startsWith("on") && value.startsWith("javascript:") && name.slice(2, 3) != "-") {
        attr.value = "javascript:" + rewriter.rewriteJS(value.slice("javascript:".length), {inline: true});
      }
      // css attrs
      else if (name === "style") {
        attr.value = rewriter.rewriteCSS(attr.value);
      }

      // background attr
      else if (name === "background") {
        attr.value = this.rewriteUrl(rewriter, value);
      }

      else if (name === "srcset" || (name === "imagesrcset" && tagName === "link")) {
        attr.value = this.rewriteSrcSet(value, rewriter);
      }

      // for now, download attribute doesn't work in Chrome
      // but disabling triggers default behavior which often does
      else if (name === "crossorigin" || name === "integrity" || name === "download") {
        attr.name = "_" + attr.name;
      }

      else if (tagName === "meta" && name === "content") {
        attr.value = this.rewriteMetaContent(tag.attrs, attr, rewriter);
      }

      else if (tagName === "param" && isUrl(value)) {
        attr.value = this.rewriteUrl(rewriter, attr.value);
      }

      else if (name.startsWith("data-") && isUrl(value)) {
        attr.value = this.rewriteUrl(rewriter, attr.value);
      }

      else if (tagName === "base" && name === "href") {
        try {
          // rewrite url, keeping relativeness intact
          attr.value = this.rewriter.updateBaseUrl(attr.value);
        } catch (e) {
          console.warn("Invalid <base>: " + attr.value);
        }
      }

      else if (tagName === "script" && name === "src") {
        const rwType = this.getScriptRWType(tag);
        const mod = (rwType === "module") ? "esm_" : null;
        const newValue = this.rewriteUrl(rewriter, attr.value, false, mod);
        if (newValue === attr.value) {// && this.isRewritableUrl(newValue)) {
          tag.attrs.push({"name": "__wb_orig_src", "value": attr.value});
          attr.value = this.rewriteUrl(rewriter, attr.value, true, mod);
        } else {
          attr.value = newValue;
        }
      }

      else if (tagName === "object" && name === "data") {
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
              attr.value = this.rewriteUrl(rewriter, value);
              tag.tagName = "iframe";
              break;
            }
          }
        }
      }

      else if (name === "target") {
        const target = attr.value;

        if (target === "_blank" || target === "_parent" || target === "_top" || target === "new") {
          attr.value = REPLAY_TOP_FRAME_NAME;
        }
      }

      else if (name === "href" || name === "src") {
        attr.value = this.rewriteUrl(rewriter, attr.value);
      }

      else {
        if (attrRules[attr.name]) {
          attr.value = this.rewriteUrl(rewriter, attr.value);
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

  getScriptRWType(tag) {
    const scriptType = this.getAttr(tag.attrs, "type");

    if (scriptType === "module") {
      return "module";
    } else if (scriptType === "application/json") {
      return "json";
    } else if (!scriptType || (scriptType.indexOf("javascript") >= 0 || scriptType.indexOf("ecmascript") >= 0)) {
      return "js";
    } else {
      return "";
    }
  }

  async rewrite(response) {
    if (!response.buffer && !response.reader) {
      //console.warn("Missing response body for: " + response.url);
      return response;
    }

    if (response.expectedLength() > MAX_HTML_REWRITE_SIZE) {
      console.warn("Skipping rewriting, HTML file too big: " + response.expectedLength());
      return response;
    }

    const rewriter = this.rewriter;

    const rwStream = new RewritingStream();
    rwStream.tokenizer.preprocessor.bufferWaterline = Infinity;

    let insertAdded = false;

    let context = "";
    let scriptRw = "";
    let replaceTag = null;

    const addInsert = () => {
      if (!insertAdded && rewriter.headInsertFunc) {
        const headInsert = rewriter.headInsertFunc(rewriter.url);
        if (headInsert) {
          rwStream.emitRaw(headInsert);
        }
        insertAdded = true;
      }
    };

    rwStream.on("startTag", startTag => {

      const tagRules = rewriteTags[startTag.tagName];

      const original = startTag.tagName;

      this.rewriteTagAndAttrs(startTag, tagRules || {}, rewriter);

      if (!insertAdded && !["head", "html"].includes(startTag.tagName)) {
        addInsert();
      }

      rwStream.emitStartTag(startTag);

      switch (startTag.tagName) {
      case "script": {
        if (startTag.selfClosing) {
          break;
        }

        context = startTag.tagName;
        scriptRw = this.getScriptRWType(startTag);
        break;
      }

      case "style":
        if (!startTag.selfClosing) {
          context = startTag.tagName;
        }
        break;

      case "head":
        addInsert();
        break;
      }

      if (startTag.tagName !== original) {
        context = original;
        replaceTag = startTag.tagName;
      }
    });

    rwStream.on("endTag", endTag => {
      if (endTag.tagName === context) {
        if (replaceTag) {
          endTag.tagName = replaceTag;
          replaceTag = null;
        }
        context = "";
      }
      rwStream.emitEndTag(endTag);
    });

    rwStream.on("text", (textToken, raw) => {
      const text = (() => {
        if (context === "script") {
          const prefix = rewriter.prefix;
          const isModule = scriptRw === "module";

          if (scriptRw === "js" || isModule) {
            return rewriter.rewriteJS(textToken.text, {isModule, prefix});
          } else if (scriptRw === "json") {
            return rewriter.rewriteJSON(textToken.text, {prefix});
          } else {
            return textToken.text;
          }
        } else if (context === "style") {
          return rewriter.rewriteCSS(textToken.text);
        } else {
          return this.rewriteHTMLText(raw);
        }
      })();

      for (let i = 0; i < text.length; i += MAX_STREAM_CHUNK_SIZE) {
        rwStream.emitRaw(text.slice(i, i + MAX_STREAM_CHUNK_SIZE));
      }
    });

    const sourceGen = response.createIter();
    let hasData = false;

    const isCharsetUTF8 = this.isCharsetUTF8;

    response.setReader(new ReadableStream({
      async start(controller) {
        rwStream.on("data", (text) => {
          controller.enqueue(isCharsetUTF8 ? encoder.encode(text) : encodeLatin1(text));
        });

        rwStream.on("end", () => {
          controller.close();
        });

        for await (const chunk of sourceGen) {
          if (isCharsetUTF8) {
            rwStream.write(decoder.decode(chunk), "utf8");
          } else {
            rwStream.write(decodeLatin1(chunk), "latin1");
          }
          hasData = true;
        }
        if (hasData) {
          addInsert();
        }

        rwStream.end();
      },
    }));
    
    return response;
  }

  rewriteUrl(rewriter, text, forceAbs = false, mod = null) {
    // if html charset not utf-8, just convert the url to utf-8 for rewriting
    if (!this.isCharsetUTF8) {
      text = decoder.decode(encodeLatin1(text));
    }
    const res = rewriter.rewriteUrl(text, forceAbs);
    return mod ? res.replace("mp_/", mod + "/") : res;
  }

  rewriteHTMLText(text) {
    if (this.rule) {
      // todo: make more general if additional rules needed
      // for now, just replace the first match
      const replacer = this.rule.replace.replace("$U1", this.ruleMatch[1]);
      const newText = text.replace(this.rule.match, replacer);
      if (text !== newText) {
        return newText;
      }
    }
    return text;
  }
}

export { HTMLRewriter };

