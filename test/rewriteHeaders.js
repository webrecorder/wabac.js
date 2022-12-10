import test from "ava";

import { doRewrite } from "./helpers/index.js";


// ===========================================================================
async function rewriteHeaders(t, headerName, value, expected, isAjax = false) {
  const headers = {};
  headers[headerName] = value;
  const actual = await doRewrite({content: "", headers, returnHeaders: true, isAjax});

  t.is(actual.get(headerName), expected);
}

rewriteHeaders.title = (providedTitle = "Headers", name, value, expected) => `${providedTitle}: ${value} => ${expected}`.trim();


test(rewriteHeaders,
  "Link",
  "<https://example.com/path/page.html>;rel=\"preload\";as=\"script\"",
  "<http://localhost:8080/prefix/20201226101010/https://example.com/path/page.html>; rel=preload; as=script"
);


test(rewriteHeaders,
  "Link",
  "<https://example.com/path/page.html>;rel=\"preload\";as=\"script\", <https://example.com/someotherpath/page%3f.html>;rel=\"other\";as=\"stylesheet\"",
  "<http://localhost:8080/prefix/20201226101010/https://example.com/path/page.html>; rel=preload; as=script, <http://localhost:8080/prefix/20201226101010/https://example.com/someotherpath/page%3f.html>; rel=other; as=stylesheet"
);


// Not rewritten if ajax
test(rewriteHeaders,
  "Link",
  "<https://example.com/path/page.html>;rel=\"preload\";as=\"script\"",
  "<https://example.com/path/page.html>;rel=\"preload\";as=\"script\"",
  true
);

// Not rewritten, not a url
test(rewriteHeaders,
  "Link",
  "<sometext>; rel=\"test\"; as=\"script\"",
  "<sometext>; rel=test; as=script",
);




