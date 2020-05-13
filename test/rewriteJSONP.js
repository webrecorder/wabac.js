"use strict";

import test from 'ava';

import { doRewrite } from './helpers';


// ===========================================================================
async function rewriteJSONP(t, content, expected, useBaseRules = true) {
  const url = 'http://example.com/?callback=jQuery_ABC'
  const actual = await doRewrite({content, contentType: "application/json", url, useBaseRules});

  if (expected) {
    t.is(actual, expected);
  } else {
    t.is(actual, content);
  }
}

rewriteJSONP.title = (providedTitle = 'JSONP', input, expected) => `${providedTitle}: ${input} => ${expected ? expected : 'UNCHANGED'}`.trim();


// ===========================================================================
async function rewriteJSONPMissingCB(t, content, useBaseRules = true) {
  const url = 'http://example.com/'
  const actual = await doRewrite({content, contentType: "application/json", url, useBaseRules});

  t.is(actual, content);
}

rewriteJSONPMissingCB.title = (providedTitle = 'JSONP Missing Callback', input, expected) => `${providedTitle}: ${input} => ${expected}`.trim();



// valid jsonp
test(rewriteJSONP,
  'jQuery_1234({"foo": "bar", "some": "data"})',
  'jQuery_ABC({"foo": "bar", "some": "data"})')


test(rewriteJSONP,
  '    jQuery_1234({"foo": "bar", "some": "data"})',
  'jQuery_ABC({"foo": "bar", "some": "data"})');


test(rewriteJSONP,
  ' /**/ jQuery_1234({"foo": "bar", "some": "data"})',
  'jQuery_ABC({"foo": "bar", "some": "data"})');


test(rewriteJSONP,
  ' /* some comment */ jQuery_1234({"foo": "bar", "some": "data"})',
  'jQuery_ABC({"foo": "bar", "some": "data"})');


test(rewriteJSONP,
  `// some comment
 jQuery_1234({"foo": "bar", "some": "data"})`,
  'jQuery_ABC({"foo": "bar", "some": "data"})');


test(rewriteJSONP,
  `// some comment
 // blah = 4;
 jQuery_1234({"foo": "bar", "some": "data"})`,
        'jQuery_ABC({"foo": "bar", "some": "data"})');


// JSONP valid but 'callback=' missing in url tests
test(rewriteJSONPMissingCB,
  'jQuery_1234({"foo": "bar", "some": "data"})');


test(rewriteJSONPMissingCB,
  `// some comment
 jQuery_1234({"foo": "bar", "some": "data"})`);



// Invalid JSONP Tests, input unchanged
test(rewriteJSONP,
  ' /* comment jQuery_1234({"foo": "bar", "some": "data"})');


test(rewriteJSONP,
  'function jQuery_1234({"foo": "bar", "some": "data"})');


test(rewriteJSONP,
  'var foo = ({"foo": "bar", "some": "data"})');


test(rewriteJSONP,
  ' abc /* some comment */ jQuery_1234({"foo": "bar", "some": "data"})');


test(rewriteJSONP,
  `// some comment
 blah = 4;
 jQuery_1234({"foo": "bar", "some": "data"})`);


