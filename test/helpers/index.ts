/*global Headers, Request*/
/*eslint no-undef: "error"*/


import { Rewriter } from "../../src/rewrite/index";

import { ArchiveResponse } from "../../src/response";
import { ArchiveRequest } from "../../src/request";

import { encodeLatin1 } from "../../src/utils";


export async function doRewrite({
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
  headersDict={}}) {

  const RW = new Rewriter({baseUrl: url, prefix: "http://localhost:8080/prefix/20201226101010mp_/", useBaseRules, headInsertFunc});
  //const resp = new Response(content, {"headers": {"Content-Type": contentType}});
  const date = new Date("2019-01-02T03:00:00Z");
  const payload = encoding !== "latin1" ? new TextEncoder().encode(content) : encodeLatin1(content);

  const headers = new Headers({...headersDict, "Content-Type": contentType});

  const resp = new ArchiveResponse({payload, headers, date, isLive, extraOpts, url, status: 200, statusText: "OK"});

  const respHeaders = new Headers();

  if (isAjax) {
    respHeaders.set("X-Pywb-Requested-With", "XMLHttpRequest");
  }

  const res = await RW.rewrite(resp, new ArchiveRequest("20201226101010mp_/" + url, new Request(url, {headers: respHeaders, mode: "same-origin"})));

  const { text } = await res.getText(encoding === "utf8");

  return { text, headers: res.headers };
}
