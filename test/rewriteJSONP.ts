import test from "ava";

import { doRewrite } from "./helpers/index.js";

// ===========================================================================
const rewriteJSONP = test.macro({
  async exec(
    t,
    content: string,
    expected: string,
    url = "http://example.com/?callback=jQuery_ABC",
    useBaseRules = true,
  ) {
    const { text: actual } = await doRewrite({
      content,
      contentType: "application/json",
      // @ts-expect-error [TODO] - TS2322 - Type 'unknown' is not assignable to type 'string | undefined'.
      url,
      // @ts-expect-error [TODO] - TS2322 - Type 'unknown' is not assignable to type 'boolean | undefined'.
      useBaseRules,
    });

    if (expected) {
      t.is(actual, expected);
    } else {
      t.is(actual, content);
    }
  },

  title(providedTitle = "JSONP", input, expected) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string
    return `${providedTitle}: ${input} ${expected ? expected : "UNCHANGED"}`.trim();
  },
});

// ===========================================================================
const rewriteJSONPMissingCB = test.macro({
  async exec(t, content: string, useBaseRules = true) {
    const url = "http://example.com/";
    const { text: actual } = await doRewrite({
      content,
      contentType: "application/json",
      url,
      // @ts-expect-error [TODO] - TS2322 - Type 'unknown' is not assignable to type 'boolean | undefined'.
      useBaseRules,
    });

    t.is(actual, content);
  },

  title(providedTitle = "JSONP Missing Callback", input, expected) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `${providedTitle}: ${input} => ${expected}`.trim();
  },
});

// valid jsonp
test(
  rewriteJSONP,
  'jQuery_1234({"foo": "bar", "some": "data"})',
  'jQuery_ABC({"foo": "bar", "some": "data"})',
);

test(
  "test with space",
  rewriteJSONP,
  '    jQuery_1234({"foo": "bar", "some": "data"})',
  'jQuery_ABC({"foo": "bar", "some": "data"})',
);

test(
  rewriteJSONP,
  ' /**/ jQuery_1234({"foo": "bar", "some": "data"})',
  'jQuery_ABC({"foo": "bar", "some": "data"})',
);

test(
  rewriteJSONP,
  ' /* some comment */ jQuery_1234({"foo": "bar", "some": "data"})',
  'jQuery_ABC({"foo": "bar", "some": "data"})',
);

test(
  rewriteJSONP,
  'some.other.object1234({"foo": "bar", "some": "data"})',
  'some.other.object5678({"foo": "bar", "some": "data"})',
  "http://example.com/?jsonp=some.other.object5678",
);

test(
  rewriteJSONP,
  `// some comment
 jQuery_1234({"foo": "bar", "some": "data"})`,
  'jQuery_ABC({"foo": "bar", "some": "data"})',
);

test(
  rewriteJSONP,
  `// some comment
 // blah = 4;
 jQuery_1234({"foo": "bar", "some": "data"})`,
  'jQuery_ABC({"foo": "bar", "some": "data"})',
);

// JSONP valid but 'callback=' missing in url tests
test(rewriteJSONPMissingCB, 'jQuery_1234({"foo": "bar", "some": "data"})');

test(
  rewriteJSONPMissingCB,
  `// some comment
 jQuery_1234({"foo": "bar", "some": "data"})`,
);

// Invalid JSONP Tests, input unchanged
test(
  rewriteJSONP,
  ' /* comment jQuery_1234({"foo": "bar", "some": "data"})',
  "",
);

test(rewriteJSONP, 'function jQuery_1234({"foo": "bar", "some": "data"})', "");

test(rewriteJSONP, 'var foo = ({"foo": "bar", "some": "data"})', "");

test(
  rewriteJSONP,
  ' abc /* some comment */ jQuery_1234({"foo": "bar", "some": "data"})',
  "",
);

test(
  rewriteJSONP,
  `// some comment
 blah = 4;
 jQuery_1234({"foo": "bar", "some": "data"})`,
  "",
);
