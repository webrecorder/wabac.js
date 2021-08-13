import SAXParser from "parse5-sax-parser";

import { decodeContent } from "./rewrite/decoder";


const SKIPPED_TAGS = ["script", "style", "header", "footer", "banner-div", "noscript"];


// ===========================================================================
async function extractText(url, buffer, ce, te) {
  const parser = new SAXParser();
  const textChunks = [];
  let context = null;

  parser.on("text", (data/*, raw*/) => {
    if (context) {
      return;
    }
    const text = data.text.trim();
    if (text) {
      textChunks.push(text);
    }
  });

  parser.on("startTag", startTag => {
    if (!startTag.selfClosing && SKIPPED_TAGS.includes(startTag.tagName)) {
      context = startTag.tagName;
    }
  });

  parser.on("endTag", endTag => {
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
