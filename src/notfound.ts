import { getCSP, getStatusText } from "./utils";

import DEFAULT_ERROR_HTML from "./templates/notFound.html";

let notFoundHtml = "";

export async function setNotFoundTemplate(url: string) {
  try {
    const resp = await fetch(url);
    notFoundHtml = await resp.text();
  } catch (e) {
    console.error("not found template fetch failed", e);
  }
}

export function notFound(request: Request, msg?: string, status = 404) {
  return notFoundByTypeResponse(request, request.url, "", false, status, msg);
}

export function notFoundByTypeResponse(
  request: Request,
  requestURL: string,
  requestTS: string,
  liveRedirectOnNotFound = false,
  status = 404,
  msg?: string,
) {
  let content: string;
  let contentType: string;

  switch (request.destination as string) {
    case "json":
    case "":
      content = getJSONNotFound(requestURL, requestTS, msg);
      contentType = "application/json; charset=utf-8";
      break;

    case "script":
      content = getScriptCSSNotFound("Script", requestURL, requestTS, msg);
      contentType = "text/javascript; charset=utf-8";
      break;

    case "style":
      content = getScriptCSSNotFound("CSS", requestURL, requestTS, msg);
      contentType = "text/css; charset=utf-8";
      break;

    case "document":
    case "embed":
    case "iframe":
    case "frame":
    default:
      content = getHTMLNotFound(
        request,
        requestURL,
        requestTS,
        liveRedirectOnNotFound,
        msg,
      );
      contentType = "text/html; charset=utf-8";
  }

  return textToResponse(content, contentType, status);
}

function textToResponse(content: string, contentType: string, status = 200) {
  const buff = new TextEncoder().encode(content);

  const initOpt = {
    status: status,
    statusText: getStatusText(status),
    headers: {
      "Content-Type": contentType,
      "Content-Length": buff.length + "",
      "Content-Security-Policy": getCSP(),
    },
  };

  return new Response(buff, initOpt);
}

function getHTMLNotFound(
  request: Request,
  requestURL: string,
  requestTS: string,
  liveRedirectOnNotFound: boolean,
  msg?: string,
) {
  let html = notFoundHtml || DEFAULT_ERROR_HTML;
  html = html.replaceAll("$REQUEST_URL", JSON.stringify(requestURL));
  html = html.replaceAll("$REQUEST_TS", JSON.stringify(requestTS));
  html = html.replaceAll(
    "$REDIRECT_NOT_FOUND",
    liveRedirectOnNotFound && request.mode === "navigate" ? "1" : "0",
  );
  html = html.replaceAll(
    "$REQUEST_ERR_MSG",
    JSON.stringify(msg || "Sorry, this page was not found in this archive:"),
  );
  return html;
}

function getScriptCSSNotFound(
  type: string,
  requestURL: string,
  requestTS: string,
  msg?: string,
) {
  return `\
/*
   ${msg || type + " Not Found"}
   URL: ${requestURL}
   TS: ${requestTS}
*/
  `;
}

function getJSONNotFound(URL: string, TS: string, error = "not_found") {
  return JSON.stringify({ error, URL, TS });
}

export function getProxyNotFoundResponse(url: string, status: number) {
  return textToResponse(getHTMLNotProxyError(url, status), "text/html", status);
}

function getHTMLNotProxyError(requestURL: string, status: number) {
  return /* HTML */ `
    <!doctype html>
    <html>
      <head>
        <script>
          window.requestURL = ${JSON.stringify(requestURL)};
        </script>
      </head>
      <body style="font-family: sans-serif">
        <h2>Live page could not be loaded</h2>
        <p>
          Sorry, this page was could not be loaded through the archiving proxy.
          Check the URL and try again.
        </p>
        <p>
          <code
            id="url"
            style="word-break: break-all; font-size: larger"
          ></code>
        </p>
        <p id="goback" style="display: none">
          <a href="#" onclick="window.history.back()">Go Back</a> to the
          previous page.
        </p>

        <script>
          document.getElementById("url").innerText = ${JSON.stringify(
            `Status Code: ${status}`,
          )};
          let isTop = true;
          try {
            if (window.parent._WB_wombat_location) {
              isTop = false;
            }
          } catch (e) {}
          if (isTop) {
            document.querySelector("#goback").style.display = "";

            window.parent.postMessage(
              {
                wb_type: "live-proxy-url-error",
                url: window.requestURL,
                status: ${JSON.stringify(status)},
              },
              "*",
            );
          }
        </script>
      </body>
    </html>
  `;
}
