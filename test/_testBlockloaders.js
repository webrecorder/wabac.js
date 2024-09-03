"use strict";

import test from "ava";

import { createLoader } from "../src/blockloaders.js";

test("Load data from IPFS Blockloader", async (t) => {
  const url =
    "ipfs://bafybeibpyor6sjdarqmbqpc7cxr2rwc2gv6vnvuwmgteiicaa6adbcjex4/webarchive.wacz";

  const loader = await createLoader({ url });

  const length = await loader.getLength();

  t.truthy(length, "Got a valid length");

  const chunks = await loader.getRange(0, 16);

  const expected = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x2d, 0x00, 0x08, 0x00, 0x00, 0x00, 0x3d, 0x79,
    0x36, 0x55, 0x00, 0x00,
  ]);

  t.deepEqual(chunks, expected, "Got chunks from loader");
});
