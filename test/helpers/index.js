import test from 'ava';

import { Rewriter } from '../../src/rewrite';

import { Headers, Request, Response } from 'node-fetch';
import { ReadableStream } from "web-streams-polyfill/es6";

global.Response = Response;
global.Request = Request;
global.Headers = Headers;
global.ReadableStream = ReadableStream;

async function doRewrite({content, contentType, url = "https://example.com/some/path/index.html", useBaseRules = true}) {
  const RW = new Rewriter(url, "http://localhost:8080/prefix/20201226101010/", null, useBaseRules);
  const resp = new Response(content, {"headers": {"Content-Type": contentType}});
  resp.date = new Date("2019-01-02T03:00:00Z");
  resp.timestamp = "20190102030000";

  const body = resp.body;

  resp.body.getReader = function() {
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      }
    });
    return rs.getReader();
  }

  const res = await RW.rewrite(resp, new Request("https://example.com/"), "", false);

  return await res.text();
}

export { doRewrite };
