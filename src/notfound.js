import { getStatusText } from "./utils.js";

export function notFoundByTypeResponse(request, requestURL, requestTS, liveRedirectOnNotFound = false, status = 404) {
  let content;
  let contentType;

  switch (request.destination) {
  case "json":
  case "":
    content = getJSONNotFound(requestURL, requestTS);
    contentType = "application/json; charset=utf-8";
    break;

  case "script":
    content = getScriptCSSNotFound("Script", requestURL, requestTS);
    contentType = "text/javascript; charset=utf-8";
    break;

  case "style":
    content = getScriptCSSNotFound("CSS", requestURL, requestTS);
    contentType = "text/css; charset=utf-8";
    break;

  case "document":
  case "embed":
  case "iframe":
  case "frame":
  default:
    content = getHTMLNotFound(request, requestURL, requestTS, liveRedirectOnNotFound);
    contentType = "text/html; charset=utf-8";
  }

  const buff = new TextEncoder().encode(content);

  const initOpt = {
    "status": status,
    "statusText": getStatusText(status),
    "headers": { "Content-Type": contentType, "Content-Length": buff.length }
  };

  return new Response(buff, initOpt);
}


function getHTMLNotFound(request, requestURL, requestTS, liveRedirectOnNotFound) {
  return `
  <!doctype html>
  <html>
  <head>
  <script>
  window.requestURL = "${requestURL}";
  </script>
  </head>
  <body style="font-family: sans-serif">
  <h2>Archived Page Not Found</h2>
  <p>Sorry, this page was not found in this archive:</p>
  <p><code id="url" style="word-break: break-all; font-size: larger"></code></p>
  ${liveRedirectOnNotFound && request.mode === "navigate" ? `
  <p>Redirecting to live page now... (If this URL is a file download, the download should have started).</p>
  <script>
  window.top.location.href = window.requestURL;
  </script>
  ` : `
  `}
  <p id="goback" style="display: none"><a href="#" onclick="window.history.back()">Go Back</a> to the previous page.</a></p>
  
  <p>
  <a id="livelink" target="_blank" href="">Load the live page</a> in a new tab (or download the file, if this URL points to a file).
  </p>

  <script>
  document.querySelector("#url").innerText = window.requestURL;
  document.querySelector("#livelink").href = window.requestURL;
  let isTop = true;
  try {
    if (window.parent._WB_wombat_location) {
      isTop = false;
    }
  } catch (e) {

  }
  if (isTop) {
    document.querySelector("#goback").style.display = "";

    window.parent.postMessage({
      wb_type: "archive-not-found",
      url: window.requestURL,
      ts: "${requestTS}"
    }, "*");
  }
  </script>
  </body>
  </html>
  `;
}

function getScriptCSSNotFound(type, requestURL, requestTS) {
  return `\
/* 
   ${type} Not Found
   URL: ${requestURL}
   TS: ${requestTS}
*/
  `;
}

function getJSONNotFound(URL, TS, error = "not_found") {
  return JSON.stringify({error, URL, TS});
}
