import { Rewriter } from "../../src/rewrite";

import fetch from "@titelmedia/node-fetch";
import { ReadableStream } from "web-streams-node";
import { ArchiveResponse } from "../../src/response";

const { Headers, Request } = fetch;


global.Headers = Headers;
global.fetch = fetch;

global.__IPFS_CORE_URL__ = "";

const encoder = new TextEncoder("utf-8");


async function doRewrite({
  content,
  contentType,
  url = "https://example.com/some/path/index.html",
  useBaseRules = true,
  isLive = false,
  isAjax = false,
  extraOpts = null,
  returnHeaders = false,
  headers={}}) {
  const RW = new Rewriter({baseUrl: url, prefix: "http://localhost:8080/prefix/20201226101010/", useBaseRules});
  //const resp = new Response(content, {"headers": {"Content-Type": contentType}});
  const date = new Date("2019-01-02T03:00:00Z");
  const payload = encoder.encode(content);

  headers = new Headers({...headers, "Content-Type": contentType});

  const resp = new ArchiveResponse({payload, headers, date, isLive, extraOpts});

  const respHeaders = new Headers();

  if (isAjax) {
    respHeaders.set("X-Pywb-Requested-With", "XMLHttpRequest");
  }

  const res = await RW.rewrite(resp, new Request(url, {headers: respHeaders}));

  return returnHeaders ? res.headers : await res.getText();
}

export { doRewrite, fetch, ReadableStream };
