import test from "ava";

import { doRewrite } from "./helpers/index.js";


// ===========================================================================
async function rewriteCSS(t, content, expected, encoding = "utf8", expectedContentType = "text/css") {
  const opts = {content, contentType: "text/css", useBaseRules: false, encoding};
  const actual = await doRewrite(opts);

  if (!expected) {
    expected = content;
  }

  t.is(actual, expected);

  const headers = await doRewrite({returnHeaders: true, ...opts});

  t.is(headers.get("content-type"), expectedContentType);
}

rewriteCSS.title = (providedTitle = "CSS", input/*, expected*/) => `${providedTitle}: ${input.replace(/\n/g, "\\n")}`.trim();


test(rewriteCSS,
  "background-image: url('https://example.com/')",
  "background-image: url('http://localhost:8080/prefix/20201226101010mp_/https://example.com/')");

test(rewriteCSS,
  "background:url( https://example.com )",
  "background:url( http://localhost:8080/prefix/20201226101010mp_/https://example.com)");

test(rewriteCSS,
  "@import \"https://example.com/path/filename.html\"",
  "@import \"http://localhost:8080/prefix/20201226101010mp_/https://example.com/path/filename.html\"");


test("bom in css, convert to utf8", rewriteCSS,
  "\xEF\xBB\xBF.test{content:\"\xEE\x80\xA2\"}",
  ".test{content:\"\xEE\x80\xA2\"}",
  "latin1",
  "text/css; charset=utf-8"
);
