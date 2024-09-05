// @ts-expect-error [TODO] - TS2792 - Cannot find module 'ava'. Did you mean to set the 'moduleResolution' option to 'node', or to add aliases to the 'paths' option?
import test from "ava";

import { doRewrite } from "./helpers/index.js";

// ===========================================================================
const rewriteHeaders = test.macro({
  async exec(
    // @ts-expect-error [TODO] - TS7006 - Parameter 't' implicitly has an 'any' type.
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
      isAjax,
      contentType: "text/html",
    });

    t.is(headers.get(headerName), expected);
  },

  // @ts-expect-error [TODO] - TS7006 - Parameter 'name' implicitly has an 'any' type. | TS7006 - Parameter 'value' implicitly has an 'any' type. | TS7006 - Parameter 'expected' implicitly has an 'any' type.
  title(providedTitle = "Headers", name, value, expected) {
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
