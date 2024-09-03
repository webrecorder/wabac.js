import test, { type ExecutionContext } from "ava";
import { FuzzyMatcher } from "../src/fuzzymatcher.js";

const fuzzy = new FuzzyMatcher();

function fuzzyMatch(t: ExecutionContext, url: string, result: string) {
  const res = fuzzy.fuzzyCompareUrls(url, [{ url: result, status: 200 }]);
  t.deepEqual(res ? res.url : "", result);
}

function fuzzyMatchMany(
  t: ExecutionContext,
  url: string,
  results: string[],
  expected: string,
) {
  const res = fuzzy.fuzzyCompareUrls(
    url,
    results.map((url: string) => {
      return { url, status: 200 };
    }),
  );
  t.deepEqual(res ? res.url : "", expected);
}

function fuzzyCanonWithArgs(
  t: ExecutionContext,
  url: string,
  expected: string[],
) {
  const fuzzyCanonUrls = fuzzy.getFuzzyCanonsWithArgs(url);
  t.deepEqual(fuzzyCanonUrls, expected);
}

test(
  "fuzzy canon args yt",
  fuzzyCanonWithArgs,
  "https://www.youtube.com/get_video_info?foo=bar&html5=1&video_id=12345678&pn=JiUSOZ2NVdJy1uam&eurl=baz",
  ["https://youtube.fuzzy.replayweb.page/get_video_info?video_id=12345678"],
);

test(
  "fuzzy canon args yt 2",
  fuzzyCanonWithArgs,
  "https://blah.blah.boo.googlevideo.com/videoplayback?foo=bar&itag=3&id=12345678&pn=JiUSOZ2NVdJy1uam&eurl=baz",
  [
    "https://youtube.fuzzy.replayweb.page/videoplayback?id=12345678&itag=3",
    "https://youtube.fuzzy.replayweb.page/videoplayback?id=12345678",
  ],
);

test(
  "fuzzy canon args timestamp",
  fuzzyCanonWithArgs,
  "https://example.com?1234",
  ["https://example.com?"],
);

test(
  "fuzzy canon args timestamp 2",
  fuzzyCanonWithArgs,
  "https://example.com?_=1234",
  ["https://example.com?"],
);

test(
  "simple url",
  fuzzyMatch,
  "https://example.com/abc",
  "https://example.com/abc",
);

test(
  "no ext, _= timestamp",
  fuzzyMatch,
  "https://example.com/abc?_=1234",
  "https://example.com/abc",
);

test(
  "allowed ext",
  fuzzyMatch,
  "https://example.com/abc.mp4?foo=bar&__123=xyz",
  "https://example.com/abc.mp4",
);

test(
  "other ext",
  fuzzyMatch,
  "https://example.com/abc.asp?foo=bar&__123=xyz",
  "https://example.com/abc.asp?foo=bar&__123=xyz",
);

test(
  "match ga utm",
  fuzzyMatch,
  "http://example.com/someresponse?_=1234&utm_A=123&id=xyz&utm_robot=blue&utm_foo=bar&A=B&utm_id=xyz",
  "http://example.com/someresponse?utm_B=234&id=xyz&utm_bar=foo&utm_foo=bar&_=789&A=B",
);

test(
  "match jquery",
  fuzzyMatch,
  "http://example.com/someresponse?a=b&foocallbackname=jQuery123_456&foo=bar&_=12345&",
  "http://example.com/someresponse?a=b&foocallbackname=jQuery789_000&foo=bar&_=789&",
);

// test removal of two adjacent params
test(
  "match jquery 2",
  fuzzyMatch,
  "http://example.com/someresponse?_=1234&callbackname=jQuery123_456&foo=bar",
  "http://example.com/someresponse?_=123&callbackname=jQuery789_000&foo=bar",
);

test(
  "match yt",
  fuzzyMatch,
  "http://youtube.com/get_video_info?a=b&html5=true&___abc=123&video_id=ABCD&id=1234",
  "http://youtube.com/get_video_info?a=d&html5=true&___abc=125&video_id=ABCD&id=1234",
);

test(
  "match yt2",
  fuzzyMatch,
  "https://r1---sn-xyz.googlevideo.com/videoplayback?id=ABCDEFG&itag=22&food=abc",
  "https://r1---sn-abcdefg.googlevideo.com/videoplayback?id=ABCDEFG&itag=22&foo=abc&_1=2",
);

test(
  "compare score",
  fuzzyMatchMany,
  "https://example.com/?_=123",
  ["https://example.com/?_=456", "https://example.com/?__=123&foo=bar"],
  "https://example.com/?_=456",
);

test(
  "compare score 2",
  fuzzyMatchMany,
  "https://example.com/?a=b",
  [
    "https://example.com/?c=d&_=456",
    "https://example.com/?",
    "https://example.com/?d=f",
    "https://example.com/?__=123&foo=bar",
    "https://example.com/?_=123&__foo=789&__bar=abc",
    "https://example.com/?_=123&__foo=789&__bar=abc&a=b",
    "https://example.com/?_=123&__foo=789&__bar=abc&a=d",
  ],
  "https://example.com/?_=123&__foo=789&__bar=abc&a=b",
);

test(
  "compare score 3",
  fuzzyMatchMany,
  "https://example.com/?v=foo,bar",
  [
    "https://example.com/?v=foo&__=123",
    "https://example.com/?v=blah&__=456",
    "https://example.com/?v=bar",
    "https://example.com/?__=789",
  ],
  "https://example.com/?v=bar",
);

test(
  "compare score 4",
  fuzzyMatchMany,
  "https://example.com/?param=value",
  [
    "https://example.com/?__a=b&param=value",
    "https://example.com/?__a=b&param=foo",
  ],
  "https://example.com/?__a=b&param=value",
);
