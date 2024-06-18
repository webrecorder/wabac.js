/*global Headers, Request*/
/*eslint no-undef: "error"*/


import { Rewriter } from "../../src/rewrite/index.js";

import { ArchiveResponse } from "../../src/response.js";

async function doRewrite({
  content,
  contentType,
  url = "https://example.com/some/path/index.html",
  useBaseRules = true,
  isLive = false,
  isAjax = false,
  extraOpts = null,
  returnHeaders = false,
  headInsertFunc = null,
  encoding = "utf8",
  headers={}}) {

  const RW = new Rewriter({baseUrl: url, prefix: "http://localhost:8080/prefix/20201226101010mp_/", useBaseRules, headInsertFunc});
  //const resp = new Response(content, {"headers": {"Content-Type": contentType}});
  const date = new Date("2019-01-02T03:00:00Z");
  const payload = new TextEncoder(encoding).encode(content);

  headers = new Headers({...headers, "Content-Type": contentType});

  const resp = new ArchiveResponse({payload, headers, date, isLive, extraOpts});

  const respHeaders = new Headers();

  if (isAjax) {
    respHeaders.set("X-Pywb-Requested-With", "XMLHttpRequest");
  }

  const res = await RW.rewrite(resp, new Request(url, {headers: respHeaders, mode: "same-origin"}));

  if (returnHeaders) {
    return res.headers;
  } else { 
    const { text } = await res.getText(encoding === "utf8");
    return text;
  }
}

export { doRewrite };
