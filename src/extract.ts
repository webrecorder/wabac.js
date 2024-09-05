// @ts-expect-error [TODO] - TS2792 - Cannot find module 'parse5-sax-parser'. Did you mean to set the 'moduleResolution' option to 'node', or to add aliases to the 'paths' option?
import { SAXParser } from "parse5-sax-parser";

import { decodeContent } from "./rewrite/decoder";

const SKIPPED_TAGS = [
  "script",
  "style",
  "header",
  "footer",
  "banner-div",
  "noscript",
];

// ===========================================================================
async function extractText(
  url: string,
  buffer: Uint8Array,
  ce: string | null,
  te: string | null,
) {
  const parser = new SAXParser();
  const textChunks: string[] = [];
  let context: string | null = null;

  // @ts-expect-error [TODO] - TS7006 - Parameter 'data' implicitly has an 'any' type.
  parser.on("text", (data /*, raw*/) => {
    if (context) {
      return;
    }
    const text = data.text.trim();
    if (text) {
      textChunks.push(text);
    }
  });

  // @ts-expect-error [TODO] - TS7006 - Parameter 'startTag' implicitly has an 'any' type.
  parser.on("startTag", (startTag) => {
    if (!startTag.selfClosing && SKIPPED_TAGS.includes(startTag.tagName)) {
      context = startTag.tagName;
    }
  });

  // @ts-expect-error [TODO] - TS7006 - Parameter 'endTag' implicitly has an 'any' type.
  parser.on("endTag", (endTag) => {
    if (endTag.tagName === context) {
      context = null;
    }
  });

  if (ce || te) {
    buffer = await decodeContent(buffer, ce, te);
  }

  parser.end(new TextDecoder().decode(buffer));

  const p = new Promise((resolve) => {
    parser.on("end", () => {
      resolve(textChunks.join(" "));
    });
  });

  return await p;
}

export { extractText };
