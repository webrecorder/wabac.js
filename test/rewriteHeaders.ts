import test from "ava";

import { doRewrite } from "./helpers/index.js";

// ===========================================================================
const rewriteHeaders = test.macro({
  async exec(
    t,
    headerName: string,
    value: string,
    expected: string,
    isAjax = false,
  ) {
    const headersDict: Record<string, string> = {};
    headersDict[headerName] = value;
    const { headers } = await doRewrite({
      content: "",
      headersDict,
      // @ts-expect-error TS2322
      isAjax,
      contentType: "text/html",
    });

    t.is(headers.get(headerName), expected);
  },

  title(providedTitle = "Headers", name, value, expected) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `${providedTitle}: ${value} => ${expected}`.trim();
  },
});

test(
  rewriteHeaders,
  "Link",
  '<https://example.com/path/page.html>;rel="preload";as="script"',
  "<http://localhost:8080/prefix/20201226101010mp_/https://example.com/path/page.html>; rel=preload; as=script",
);

test(
  rewriteHeaders,
  "Link",
  '<https://example.com/path/page.html>;rel="preload";as="script", <https://example.com/someotherpath/page%3f.html>;rel="other";as="stylesheet"',
  "<http://localhost:8080/prefix/20201226101010mp_/https://example.com/path/page.html>; rel=preload; as=script, <http://localhost:8080/prefix/20201226101010mp_/https://example.com/someotherpath/page%3f.html>; rel=other; as=stylesheet",
);

// Not rewritten if ajax
test(
  rewriteHeaders,
  "Link",
  '<https://example.com/path/page.html>;rel="preload";as="script"',
  '<https://example.com/path/page.html>;rel="preload";as="script"',
  true,
);

// Not rewritten, not a url
test(
  rewriteHeaders,
  "Link",
  '<sometext>; rel="test"; as="script"',
  "<sometext>; rel=test; as=script",
);
