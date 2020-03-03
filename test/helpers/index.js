import test from 'ava';

import { Rewriter } from '../../src/rewrite';

import { Headers, Request, Response } from '@titelmedia/node-fetch';
import { ReadableStream } from "web-streams-polyfill/es6";
import { ArchiveResponse } from '../../src/response';

import { StreamReader } from '../../src/warcio';

global.Headers = Headers;

const encoder = new TextEncoder("utf-8");


async function doRewrite({content, contentType, url = "https://example.com/some/path/index.html", useBaseRules = true}) {
  const RW = new Rewriter(url, "http://localhost:8080/prefix/20201226101010/", null, useBaseRules);
  //const resp = new Response(content, {"headers": {"Content-Type": contentType}});
  const date = new Date("2019-01-02T03:00:00Z");
  const payload = encoder.encode(content);
  const resp = new ArchiveResponse({payload, headers: new Headers({"Content-Type": contentType}), date});

  const res = await RW.rewrite(resp, new Request("https://example.com/"), "", false);

  return await res.getText();
}

export { doRewrite };
