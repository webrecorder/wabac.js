/*eslint-env node */

import test from "ava";

import "fake-indexeddb/auto";

import { tsToDate } from "../src/utils.js";

import { ArchiveDB } from "../src/archivedb.js";

import crypto from "node:crypto";
import { type DigestRefCount } from "../src/types.js";

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (!global.crypto) {
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).crypto = crypto;
}

//import { createHash } from "crypto";

//global.crypto = {subtle: {digest: (type, buff) => {
//  const hash = createHash("sha256");
//  hash.update(buff);
//  return Promise.resolve(hash.digest());
//}}};

const db = new ArchiveDB("db", { minDedupSize: 0 });

function ts(timestamp: string) {
  return tsToDate(timestamp).getTime();
}

const PAGES = [
  {
    id: "01",
    url: "https://example.com/",
    title: "Example Domain",
    ts: ts("20200303040506"),
  },

  {
    id: "02",
    url: "http://another.example.com/page",
    title: "Another Page",
    ts: ts("20200102000000"),
  },

  {
    id: "03",
    url: "https://example.com/",
    title: "Example Domain Again",
    ts: ts("20210303040506"),
  },
];

const URL_DATA = [
  {
    url: "https://example.com/",
    ts: ts("202003040506"),
    pageId: "01",
    payload: new Uint8Array([1, 2, 3]),
    headers: { a: "b" },
    mime: "",
    digest: "",
  },

  {
    url: "https://example.com/script.js",
    ts: ts("202003040507"),
    pageId: "01",
    payload: new TextEncoder().encode("text"),
    headers: { a: "b" },
    mime: "",
    digest: "",
  },

  {
    url: "https://another.example.com/page",
    ts: ts("20200102000000"),
    pageId: "02",
    payload: new Uint8Array([0, 1, 0, 1]),
    headers: { a: "b" },
    mime: "",
    digest: "",
  },

  {
    url: "https://example.com/",
    ts: ts("202103040506"),
    pageId: "03",
    payload: new Uint8Array([4, 5, 6]),
    mime: "",
    digest: "",
  },

  {
    url: "https://example.com/dupe/page.html",
    ts: ts("202006040506"),
    pageId: "02",
    payload: new Uint8Array([1, 2, 3]),
    mime: "",
    digest: "",
  },
];

test("init", async (t) => {
  await db.init();
  t.pass();
});

test("Add Pages", async (t) => {
  for (const page of PAGES) {
    const pageId = await db.addPage(page, null);

    t.is(pageId, page.id);
  }
});

test("Add Url", async (t) => {
  for (const data of URL_DATA) {
    //const length = data.payload.length;
    const added = await db.addResource(data);
    if (data === URL_DATA[4]) {
      t.false(added);
    } else {
      t.true(added);
    }
  }
});

test("Lookup Url Only (Latest)", async (t) => {
  t.deepEqual(await db.lookupUrl("https://example.com/"), URL_DATA[3]);
});

test("Lookup Url Exact Ts", async (t) => {
  // exact
  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("202003040506")),
    URL_DATA[0],
  );

  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("202103040506")),
    URL_DATA[3],
  );
});

test("Lookup Url Closest Ts After", async (t) => {
  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("2015")),
    URL_DATA[0],
  );

  // matches next timestamp after
  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("202003040507")),
    URL_DATA[3],
  );

  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("20210101")),
    URL_DATA[3],
  );

  t.deepEqual(
    await db.lookupUrl("https://example.com/", ts("2030")),
    URL_DATA[3],
  );
});

test("Lookup Not Found Url", async (t) => {
  t.falsy(await db.lookupUrl("https://example.com/foo", ts("2015")));
});

test("Search by pageId", async (t) => {
  t.deepEqual(await db.resourcesByPage("01"), [URL_DATA[0], URL_DATA[1]]);
});

test("Delete with ref counts", async (t) => {
  const toDict = (results: (DigestRefCount | null)[]) => {
    const obj: Record<string, number | undefined> = {};
    for (const res of results) {
      obj[res!.digest] = res!.count;
    }
    return obj;
  };

  const allDict = toDict(await db.db!.getAll("digestRef"));

  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(allDict[URL_DATA[0].digest], 2);
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(allDict[URL_DATA[1].digest], 1);
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(allDict[URL_DATA[2].digest], 1);
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(allDict[URL_DATA[3].digest], 1);
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(allDict[URL_DATA[4].digest], 2);

  await db.deletePageResources("01");

  t.deepEqual(await db.resourcesByPage("01"), []);

  const delDict = toDict(await db.db!.getAll("digestRef"));
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(delDict[URL_DATA[0].digest], 1);
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(delDict[URL_DATA[1].digest], undefined);
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(delDict[URL_DATA[2].digest], 1);
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(delDict[URL_DATA[3].digest], 1);
  // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
  t.is(delDict[URL_DATA[4].digest], 1);

  await db.deletePageResources("02");
  await db.deletePageResources("03");
  await db.deletePageResources("04");

  t.deepEqual(toDict(await db.db!.getAll("digestRef")), {});
});
