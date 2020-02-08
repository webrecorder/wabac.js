"use strict";

import test from 'ava';
import { FuzzyMatcher } from '../src/fuzzymatcher';

const fuzzy = new FuzzyMatcher();

function fuzzyUrls(t, url, expectedResults) {
  const result = [];

  for (let res of fuzzy.fuzzyUrls(url)) {
    result.push(res);
  }

  t.deepEqual(result.slice(1), expectedResults);
}

function fuzzyMatch(t, url, anotherUrl) {
  for (let url1 of fuzzy.fuzzyUrls(url)) {
    for (let url2 of fuzzy.fuzzyUrls(anotherUrl)) {
      if (url1 === url2) {
        t.pass('match found!');
        return;
      }
    }
  }

  t.fail('match not found');
}

test('simple url', fuzzyUrls,
  'https://example.com/abc', 
  [],
);

test('no ext, _= timestamp', fuzzyUrls,
  'https://example.com/abc?_=1234',
  ['http://fuzzy.example.com/https://example.com/abc']
);

test('allowed ext', fuzzyUrls,
  'https://example.com/abc.mp4?foo=bar&__123=xyz',
  ['http://fuzzy.example.com/https://example.com/abc.mp4']
)

test('other ext', fuzzyUrls,
  'https://example.com/abc.asp?foo=bar&__123=xyz', 
  []
)

test('match ga utm', fuzzyMatch,
  'http://example.com/someresponse?_=1234&utm_A=123&id=xyz&utm_robot=blue&utm_foo=bar&A=B&utm_id=xyz',
  'http://example.com/someresponse?utm_B=234&id=xyz&utm_bar=foo&utm_foo=bar&_=789&A=B',
);

test('match jquery', fuzzyMatch,
  'http://example.com/someresponse?a=b&foocallbackname=jQuery123_456&foo=bar&_=12345&',
  'http://example.com/someresponse?a=b&foocallbackname=jQuery789_000&foo=bar&_=789&');

// test removal of two adjacent params
test('match jquery 2', fuzzyMatch,
  'http://example.com/someresponse?_=1234&callbackname=jQuery123_456&foo=bar',
  'http://example.com/someresponse?_=123&callbackname=jQuery789_000&foo=bar');

test('match yt', fuzzyMatch,
  'http://youtube.com/get_video_info?a=b&html5=true&___abc=123&video_id=ABCD&id=1234',
  'http://youtube.com/get_video_info?a=d&html5=true&___abc=125&video_id=ABCD&id=1234')

test('match yt2', fuzzyMatch,
  'https://r1---sn-xyz.googlevideo.com/videoplayback?id=ABCDEFG&itag=22&food=abc',
  'https://r1---sn-abcdefg.googlevideo.com/videoplayback?id=ABCDEFG&itag=22&foo=abc&_1=2');


