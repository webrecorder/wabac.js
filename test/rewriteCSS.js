import test from "ava";

import { doRewrite } from "./helpers/index.js";


// ===========================================================================
async function rewriteCSS(t, content, expected, useBaseRules = false) {
  const actual = await doRewrite({content, contentType: "text/css", useBaseRules});

  if (!expected) {
    expected = content;
  }

  t.is(actual, expected);
}

rewriteCSS.title = (providedTitle = "CSS", input/*, expected*/) => `${providedTitle}: ${input.replace(/\n/g, "\\n")}`.trim();


test(rewriteCSS,
  "background-image: url('https://example.com/')",
  "background-image: url('http://localhost:8080/prefix/20201226101010/https://example.com/')");

test(rewriteCSS,
  "background:url( https://example.com )",
  "background:url( http://localhost:8080/prefix/20201226101010/https://example.com)");

test(rewriteCSS,
  "@import \"https://example.com/path/filename.html\"",
  "@import \"http://localhost:8080/prefix/20201226101010/https://example.com/path/filename.html\"");
