import test from "ava";

import { doRewrite } from "./helpers/index.js";

// ===========================================================================
const rewriteCSS = test.macro({
  async exec(
    t,
    content: string,
    expected: string,
    encoding: string | undefined = "utf8",
    expectedContentType: string | undefined = "text/css",
  ) {
    const opts = {
      content,
      contentType: "text/css",
      useBaseRules: false,
      encoding,
    };
    const { text: actual } = await doRewrite(opts);

    if (!expected) {
      expected = content;
    }

    t.is(actual, expected);

    const { headers } = await doRewrite(opts);

    t.is(headers.get("content-type"), expectedContentType);
  },

  title(providedTitle = "CSS", input: string /*, expected*/) {
    return `${providedTitle}: ${input.replace(/\n/g, "\\n")}`.trim();
  },
});

test(
  rewriteCSS,
  "background-image: url('https://example.com/')",
  "background-image: url('http://localhost:8080/prefix/20201226101010mp_/https://example.com/')",
);

test(
  rewriteCSS,
  "background:url( https://example.com )",
  "background:url( http://localhost:8080/prefix/20201226101010mp_/https://example.com)",
);

test(
  rewriteCSS,
  '@import "https://example.com/path/filename.html"',
  '@import "http://localhost:8080/prefix/20201226101010mp_/https://example.com/path/filename.html"',
);

test(
  "bom in css, convert to utf8",
  rewriteCSS,
  '\xEF\xBB\xBF.test{content:"\xEE\x80\xA2"}',
  '.test{content:"\xEE\x80\xA2"}',
  "latin1",
  "text/css; charset=utf-8",
);
