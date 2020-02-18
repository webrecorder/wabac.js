"use strict";

require("fake-indexeddb/auto");

import { } from './helpers';

import test from 'ava';

import { tsToDate } from '../src/utils';

import { ArchiveDB } from '../src/archiveDB';

const db = new ArchiveDB("db");

function ts(timestamp) {
  return tsToDate(timestamp).getTime();
}

const PAGES = [
{
  "id": 1,
  "url": "https://example.com/",
  "title": "Example Domain",
  "ts": ts("20200303040506"),
},

{
  "id": 2,
  "url": "http://another.example.com/page",
  "title": "Another Page",
  "ts": ts("20200102000000"),
},

{
  "id": 3,
  "url": "https://example.com/",
  "title": "Example Domain Again",
  "ts": ts("20210303040506"),
}
];


const URL_DATA = [
{
  "url": "https://example.com/",
  "ts": ts("202003040506"),
  "pageId": 1,
  "content": new Uint8Array([1, 2, 3]),
  "headers": {"a": "b"},
},

{
  "url": "https://example.com/script.js",
  "ts": ts("202003040507"),
  "pageId": 1,
  "content": "text",
  "headers": {"a": "b"}
},

{
  "url": "https://another.example.com/page",
  "ts": ts("20200102000000"),
  "pageId": 2,
  "content": new Uint8Array([0, 1, 0, 1]),
  "headers": {"a": "b"}
},

{
  "url": "https://example.com/",
  "ts": ts("202103040506"),
  "pageId": 3,
  "content": new Uint8Array([4, 5, 6])
},

]





test('init', async t => { 
  await db.init();
  t.pass();
});



test('Add Pages', async t => {
  let count = 1;

  for (const page of PAGES) {
    const pageIndex = await db.addPage(page);

    t.is(pageIndex, count++);
  }
});


test('Add Url', async t => {
  let count = 0;

  for (const data of URL_DATA) {
    t.deepEqual(
      await db.addUrl(data),
      [data.url, data.ts]
    );
  }
});


test('Lookup Url Only (Latest)', async t => {
  t.deepEqual(
    await db.lookupUrl("https://example.com/"),
    URL_DATA[3]
  );
});



test('Lookup Url Exact Ts', async t => {
  // exact
  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("202003040506")),
    URL_DATA[0]
  );

  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("202103040506")),
    URL_DATA[3]
  );
});


test('Lookup Url Closest Ts', async t => {
  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("2015")),
    URL_DATA[0]
  );

  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("202003040507")),
    URL_DATA[0]
  );

  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("20210101")),
    URL_DATA[3]
  );

  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("2030")),
    URL_DATA[3]
  );

});


test('Lookup Not Found Url', async t => {
  t.not(await db.lookupUrl("https://example.com/foo", ts("2015")));
});


test('Search by pageId', async t => {
  t.deepEqual(
    await db.resourcesByPage(1),
    [URL_DATA[0], URL_DATA[1]]
  );

  await db.deletePageResources(1);

  t.deepEqual(
    await db.resourcesByPage(1),
    []
  );

});

