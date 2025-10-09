import { RewritingStream } from "parse5-html-rewriting-stream";

import {
  startsWithAny,
  decodeLatin1,
  encodeLatin1,
  MAX_STREAM_CHUNK_SIZE,
  REPLAY_TOP_FRAME_NAME,
} from "../utils";
import {
  type ProxyRewriter,
  type ArchiveResponse,
  type Rewriter,
} from "./index.js";
import { type StartTag } from "parse5-sax-parser";
import { type Token } from "parse5";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ===========================================================================
const META_REFRESH_REGEX =
  /([\d.]+\s*;\s*(?:url\s*=)?\s*)['"]?(.+)['"]?(\s*)/im;

const DATA_RW_PROTOCOLS = ["http://", "https://", "//"];

const defmod = "mp_";

const MAX_HTML_REWRITE_SIZE = 50000000;

const UTF_MATCH = ["utf-8", "utf8"];

const rewriteTags: Record<string, Record<string, string>> = {
  a: { href: "ln_" },
  applet: {
    codebase: "oe_",
    archive: "oe_",
  },
  area: { href: defmod },
  audio: { src: "oe_" },
  base: { href: defmod },
  blockquote: { cite: defmod },
  body: { background: "im_" },
  button: { formaction: defmod },
  command: { icon: "im_" },
  del: { cite: defmod },
  embed: { src: "oe_" },
  iframe: { src: "if_" },
  image: { src: "im_", "xlink:href": "im_", href: "im_" },
  img: {
    src: "im_",
    srcset: "im_",
  },
  ins: { cite: defmod },
  input: {
    src: "im_",
    formaction: defmod,
  },
  form: { action: defmod },
  frame: { src: "fr_" },
  link: { href: "oe_" },
  meta: { content: "mt_" },
  object: {
    codebase: "oe_",
    data: "oe_",
  },
  param: { value: "oe_" },
  q: { cite: defmod },
  ref: { href: "oe_" },
  script: { src: "js_", "xlink:href": "js_" },
  source: { src: "oe_", srcset: "oe_" },
  video: {
    src: "oe_",
    poster: "im_",
  },
};

const OBJECT_FLASH_DATA_RX = [
  {
    match: /youtube.com\/v\/([^&]+)[&]/,
    replace: "youtube.com/embed/$1?",
  },
];

type TextNodeRewriteRule = {
  urlMatch: RegExp;
  match: RegExp;
  replace: string;
};

const TEXT_NODE_REWRITE_RULES: TextNodeRewriteRule[] = [
  {
    urlMatch: /[?&]:loadOrderID=([\d]+)/,
    match: /(loadOrderID&(quot;&)?#x[^;]+?;)([\d]+)/gi,
    replace: "$1$U1",
  },
];

// ===========================================================================
export class HTMLRewriter {
  rewriter: Rewriter;
  rule: TextNodeRewriteRule | null = null;
  ruleMatch: RegExpMatchArray | null = null;
  isCharsetUTF8: boolean;
  detectedCharset = "";

  constructor(rewriter: Rewriter) {
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

    this.isCharsetUTF8 = rewriter.isCharsetUTF8;
  }

  detectMetaCharset(buffer: Uint8Array): string {
    // only look at first bytes
    const CHARSET_PEEK_SIZE = 1024;
    const META_CHARSET_REGEX =
      /<meta[^>]*charset\s*=\s*["']?([^"'\s>/]+)["']?[^>]*>/i;
    const META_CHARSET_HTTP_EQUIV =
      /<meta[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["']?[^"']*charset\s*=\s*([^"'\s>/;]+)[^>]*>/i;

    if (buffer.length > CHARSET_PEEK_SIZE) {
      buffer = buffer.slice(0, CHARSET_PEEK_SIZE);
    }
    const text = new TextDecoder("latin1").decode(buffer);

    // Look for meta charset attribute
    const charsetMatch = text.match(META_CHARSET_REGEX);
    if (charsetMatch?.[1]) {
      return charsetMatch[1].toLowerCase();
    }

    // Look for meta http-equiv with charset in content
    const httpEquivMatch = text.match(META_CHARSET_HTTP_EQUIV);
    if (httpEquivMatch?.[1]) {
      return httpEquivMatch[1].toLowerCase();
    }

    return "";
  }

  rewriteMetaContent(
    attrs: Token.Attribute[],
    attr: Token.Attribute,
    rewriter: Rewriter,
  ) {
    let equiv = this.getAttr(attrs, "http-equiv");
    if (equiv) {
      equiv = equiv.toLowerCase();
    }

    if (equiv === "content-security-policy") {
      attr.name = "_" + attr.name;
    } else if (equiv === "refresh") {
      return attr.value.replace(
        META_REFRESH_REGEX,
        (m, p1, p2: string, p3) =>
          p1 + this.rewriteUrl(rewriter, p2, false, "mt_") + p3,
      );
    } else if (this.getAttr(attrs, "name") === "referrer") {
      return "no-referrer-when-downgrade";
    } else if (startsWithAny(attr.value, DATA_RW_PROTOCOLS)) {
      return this.rewriteUrl(rewriter, attr.value);
    }

    return attr.value;
  }

  rewriteSrcSet(value: string, rewriter: Rewriter) {
    const SRCSET_REGEX = /\s*(\S*\s+[\d.]+[wx]),|(?:\s*,(?:\s+|(?=https?:)))/;

    const rv: string[] = [];

    for (const v of value.split(SRCSET_REGEX)) {
      if (v) {
        const parts = v.trim().split(" ");
        // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
        parts[0] = this.rewriteUrl(rewriter, parts[0]);
        rv.push(parts.join(" "));
      }
    }

    return rv.join(", ");
  }

  rewriteTagAndAttrs(
    tag: StartTag,
    attrRules: Record<string, string>,
    rewriter: Rewriter,
  ): string {
    const isUrl = (val: string) => {
      return startsWithAny(val, DATA_RW_PROTOCOLS);
    };
    const tagName = tag.tagName;

    // no attribute rewriting for web-component tags, which must contain a '-'
    if (tagName.indexOf("-") > 0) {
      return "";
    }

    let addCloseTag = "";

    const replaceTag = (newTag: string) => {
      if (newTag === "iframe") {
        if (tag.selfClosing) {
          tag.selfClosing = false;
          addCloseTag = newTag;
        }
        tag.attrs.push({ name: "style", value: "border: none" });
      }
      tag.tagName = newTag;
    };

    for (const attr of tag.attrs) {
      const name = attr.name || "";
      const value = attr.value || "";

      // js attrs with javascript:
      if (value.startsWith("javascript:")) {
        attr.value =
          "javascript:" +
          rewriter.rewriteJS(value.slice("javascript:".length), {
            inline: true,
          });
      } else if (name.startsWith("on") && name.slice(2, 3) != "-") {
        // js attrs
        attr.value = rewriter.rewriteJS(value, { inline: true });
        // css attrs
      } else if (name === "style") {
        attr.value = rewriter.rewriteCSS(attr.value);
      }

      // background attr
      else if (name === "background") {
        attr.value = this.rewriteUrl(rewriter, value);
      } else if (
        name === "srcset" ||
        (name === "imagesrcset" && tagName === "link")
      ) {
        attr.value = this.rewriteSrcSet(value, rewriter);
      }

      // for now, download attribute doesn't work in Chrome
      // but disabling triggers default behavior which often does
      else if (
        name === "crossorigin" ||
        name === "integrity" ||
        name === "download"
      ) {
        attr.name = "_" + attr.name;
      } else if (tagName === "meta" && name === "content") {
        attr.value = this.rewriteMetaContent(tag.attrs, attr, rewriter);
      } else if (tagName === "meta" && name === "charset") {
        if (value && UTF_MATCH.includes(value.toLowerCase())) {
          this.isCharsetUTF8 = true;
        }
      } else if (tagName === "param" && isUrl(value)) {
        attr.value = this.rewriteUrl(rewriter, attr.value);
      } else if (name.startsWith("data-") && isUrl(value)) {
        attr.value = this.rewriteUrl(rewriter, attr.value);
      } else if (tagName === "base" && name === "href") {
        try {
          // rewrite url, keeping relativeness intact
          attr.value = this.rewriter.updateBaseUrl(attr.value);
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          console.warn("Invalid <base>: " + attr.value);
        }
      } else if (tagName === "script" && name === "src") {
        const rwType = this.getScriptRWType(tag);
        const mod = rwType === "module" ? "esm_" : "";
        const newValue = this.rewriteUrl(rewriter, attr.value, false, mod);
        if (newValue === attr.value) {
          tag.attrs.push({ name: "__wb_orig_src", value: attr.value });
          if (
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
            attr.value &&
            attr.value.startsWith("data:text/javascript;base64")
          ) {
            attr.value = this.rewriteJSBase64(attr.value, rewriter);
          } else {
            attr.value = this.rewriteUrl(rewriter, attr.value, true, mod);
          }
        } else {
          attr.value = newValue;
        }
      } else if (tagName === "object" && name === "data") {
        const type = this.getAttr(tag.attrs, "type");

        // convert object tag to iframe or img
        if (type === "application/pdf") {
          attr.name = "src";
          attr.value = this.rewriteUrl(rewriter, attr.value, false, "if_");
          replaceTag("iframe");
        } else if (type === "image/svg+xml") {
          attr.name = "src";
          attr.value = this.rewriteUrl(rewriter, attr.value);
          replaceTag("img");
        } else if (type === "application/x-shockwave-flash") {
          for (const rule of OBJECT_FLASH_DATA_RX) {
            const value = attr.value.replace(rule.match, rule.replace);
            if (value !== attr.value) {
              attr.name = "src";
              attr.value = this.rewriteUrl(rewriter, value, false, "if_");
              replaceTag("iframe");
              break;
            }
          }
        }
      } else if (tagName === "embed" && name === "src") {
        const type = this.getAttr(tag.attrs, "type") || "";
        if (type.startsWith("image/")) {
          replaceTag("img");
          attr.value = this.rewriteUrl(rewriter, value, false, "mp_");
        } else if (
          type === "application/pdf" ||
          !type.startsWith("application/")
        ) {
          replaceTag("iframe");
          attr.value = this.rewriteUrl(rewriter, value, false, "if_");
          if (type !== "application/pdf") {
            // add sandbox to prevent downloads from unknown types
            tag.attrs.push({
              name: "sandbox",
              value: "allow-same-origin allow-scripts",
            });
          }
        }
      } else if (name === "target") {
        const target = attr.value;

        if (
          target === "_blank" ||
          target === "_parent" ||
          target === "_top" ||
          target === "new"
        ) {
          attr.value = REPLAY_TOP_FRAME_NAME;
        }
      } else if (attrRules[name] || name === "href" || name === "src") {
        attr.value = this.rewriteUrl(
          rewriter,
          attr.value,
          false,
          attrRules[name],
        );
      }
    }

    return addCloseTag;
  }

  getAttr(attrs: Token.Attribute[], name: string) {
    for (const attr of attrs) {
      if (attr.name === name) {
        return attr.value;
      }
    }

    return null;
  }

  getScriptRWType(tag: StartTag) {
    const scriptType = this.getAttr(tag.attrs, "type");

    if (scriptType === "module") {
      return "module";
    } else if (scriptType === "application/json") {
      return "json";
    } else if (
      !scriptType ||
      scriptType.indexOf("javascript") >= 0 ||
      scriptType.indexOf("ecmascript") >= 0
    ) {
      return "js";
    } else if (scriptType.startsWith("text/")) {
      return "text";
    } else if (scriptType === "importmap") {
      return "importmap";
    } else {
      return "";
    }
  }

  async rewrite(response: ArchiveResponse) {
    let buffer = await response.getBuffer();
    if (!buffer) {
      return response;
    }

    if (buffer.length > MAX_HTML_REWRITE_SIZE) {
      console.warn("Skipping rewriting, HTML file too big: " + buffer.length);
      return response;
    }

    const { bomFound, text } = await response.getText(this.isCharsetUTF8, true);
    if (bomFound) {
      // make new buffer in UTF-8 with no BOM
      buffer = new TextEncoder().encode(text);
      this.isCharsetUTF8 = true;
    }

    // don't try to detect if already detected as UTF-8 or detected a charset via headers
    if (!this.isCharsetUTF8 && !this.rewriter.isCharsetDetected) {
      this.detectedCharset = this.detectMetaCharset(buffer);
      if (UTF_MATCH.includes(this.detectedCharset)) {
        this.isCharsetUTF8 = true;
      }
    }

    const rewriter = this.rewriter;

    const rwStream = new RewritingStream();
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rwStream as any).tokenizer.preprocessor.bufferWaterline = Infinity;

    let insertAdded = false;
    let headDone = false;
    let isTextEmpty = true;

    let context = "";
    let scriptRw = "";
    let replaceTag = "";

    const addInsert = () => {
      if (!insertAdded && rewriter.headInsertFunc) {
        // emit charset before rest of head insert to ensure its in the first 1024 bytes
        if (this.detectedCharset) {
          rwStream.emitRaw(`<meta charset="${this.detectedCharset}"/>`);
        }
        const headInsert = rewriter.headInsertFunc(rewriter.url);
        if (headInsert) {
          rwStream.emitRaw(headInsert);
        }
        insertAdded = true;
      }
    };

    rwStream.on("startTag", (startTag) => {
      const tagRules = rewriteTags[startTag.tagName];

      const original = startTag.tagName;

      const addCloseTag = this.rewriteTagAndAttrs(
        startTag,
        tagRules || {},
        rewriter,
      );

      if (!insertAdded && !["head", "html"].includes(startTag.tagName)) {
        addInsert();
      }

      rwStream.emitStartTag(startTag);

      // if tag is changed, eg. to iframe, need to add closing tag
      if (addCloseTag) {
        rwStream.emitEndTag({ tagName: addCloseTag });
      }

      switch (startTag.tagName) {
        case "script": {
          if (startTag.selfClosing) {
            break;
          }

          context = startTag.tagName;
          isTextEmpty = true;
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

        case "body":
          headDone = true;
          break;
      }

      if (startTag.tagName !== original) {
        context = original;
        replaceTag = startTag.tagName;
      }
    });

    rwStream.on("endTag", (endTag) => {
      if (endTag.tagName === context) {
        if (replaceTag) {
          endTag.tagName = replaceTag;
          replaceTag = "";
        }
        switch (context) {
          case "head":
            headDone = true;
            break;

          case "script":
            if (headDone && !isTextEmpty && scriptRw === "js") {
              rwStream.emitRaw(";document.close();");
            }
            break;
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

          isTextEmpty = isTextEmpty && textToken.text.trim().length === 0;

          if (scriptRw === "js" || isModule) {
            return rewriter.rewriteJS(textToken.text, { isModule, prefix });
          } else if (scriptRw === "json") {
            return rewriter.rewriteJSON(textToken.text, { prefix });
          } else if (scriptRw === "importmap") {
            return rewriter.rewriteImportmap(textToken.text);
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

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const htmlrewriter = this;

    response.setReader(
      new ReadableStream({
        async start(controller) {
          rwStream.on("data", (text) => {
            controller.enqueue(
              // [TODO]
              htmlrewriter.isCharsetUTF8
                ? // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  encoder.encode(text)
                : // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  encodeLatin1(text),
            );
          });

          rwStream.on("end", () => {
            controller.close();
          });

          if (htmlrewriter.isCharsetUTF8) {
            rwStream.write(decoder.decode(buffer), "utf8");
          } else {
            rwStream.write(decodeLatin1(buffer), "latin1");
          }
          addInsert();

          rwStream.end();
        },
      }),
    );

    return response;
  }

  rewriteUrl(rewriter: Rewriter, text: string, forceAbs = false, mod = "") {
    // if html charset not utf-8, just convert the url to utf-8 for rewriting
    if (!this.isCharsetUTF8) {
      text = decoder.decode(encodeLatin1(text));
    }
    const res = rewriter.rewriteUrl(text, forceAbs);
    return mod && mod !== defmod && mod !== "ln_" && mod !== "mt_"
      ? res.replace(defmod + "/", mod + "/")
      : res;
  }

  rewriteHTMLText(text: string) {
    if (this.rule && this.ruleMatch) {
      // todo: make more general if additional rules needed
      // for now, just replace the first match
      // @ts-expect-error [TODO] - TS2769 - No overload matches this call.
      const replacer = this.rule.replace.replace("$U1", this.ruleMatch[1]);
      const newText = text.replace(this.rule.match, replacer);
      if (text !== newText) {
        return newText;
      }
    }
    return text;
  }

  rewriteJSBase64(text: string, rewriter: Rewriter) {
    const parts = text.split(",");
    // @ts-expect-error [TODO] - TS2769 - No overload matches this call.
    const content = rewriter.rewriteJS(atob(parts[1]), { isModule: false });
    parts[1] = btoa(content);
    return parts.join(",");
  }
}

// ===========================================================================
export class ProxyHTMLRewriter extends HTMLRewriter {
  override rewriteUrl(
    rewriter: Rewriter,
    text: string,
    forceAbs = false,
    mod = "",
  ) {
    if (mod === "if_" || mod === "fr_" || mod === "mt_") {
      return (rewriter as ProxyRewriter).fullRewriteUrl(text, forceAbs);
    }

    if (mod === "ln_") {
      // if html charset not utf-8, just convert the url to utf-8 for rewriting
      if (!this.isCharsetUTF8) {
        text = decoder.decode(encodeLatin1(text));
      }

      return rewriter.rewriteUrl(text, forceAbs);
    }

    // always rewrite if http->https conversion is needed
    if ((rewriter as ProxyRewriter).httpToHttps) {
      return rewriter.rewriteUrl(text, forceAbs);
    }

    return text;
  }

  override rewriteTagAndAttrs(
    tag: StartTag,
    attrRules: Record<string, string>,
    rewriter: Rewriter,
  ): string {
    if ((rewriter as ProxyRewriter).httpToHttps) {
      return super.rewriteTagAndAttrs(tag, attrRules, rewriter);
    }

    const tagName = tag.tagName;

    if (tagName === "embed" || tagName === "object") {
      return super.rewriteTagAndAttrs(tag, attrRules, rewriter);
    }

    // no attribute rewriting for web-component tags, which must contain a '-'
    if (tagName.indexOf("-") > 0) {
      return "";
    }

    for (const attr of tag.attrs) {
      const name = attr.name || "";
      const value = attr.value || "";

      if (tagName === "meta" && name === "content") {
        attr.value = this.rewriteMetaContent(tag.attrs, attr, rewriter);
      } else if (attrRules[name] || name === "href" || name === "src") {
        attr.value = this.rewriteUrl(rewriter, value, false, attrRules[name]);
      }
    }

    return "";
  }
}
