import { getCSP, getStatusText } from "./utils";

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
  return /* HTML */ `
    <!doctype html>
    <html>
      <head>
        <script>
          window.requestURL = ${JSON.stringify(requestURL)};
        </script>
      </head>
      <body style="font-family: sans-serif">
        <h2>Archived Page Not Found</h2>
        <p id="msg"></p>
        <p>
          <code
            id="url"
            style="word-break: break-all; font-size: larger"
          ></code>
        </p>
        ${liveRedirectOnNotFound && request.mode === "navigate"
          ? /* HTML */ `
              <p>
                Redirecting to live page now... (If this URL is a file download,
                the download should have started).
              </p>
              <script>
                window.top.location.href = window.requestURL;
              </script>
            `
          : `
  `}
        <p id="goback" style="display: none">
          <a href="#" onclick="window.history.back()">Go Back</a> to the
          previous page.
        </p>

        <p>
          <a id="livelink" target="_blank" href="">Load the live page</a> in a
          new tab (or download the file, if this URL points to a file).
        </p>

        <script>
          document.querySelector("#url").innerText = window.requestURL;
          document.querySelector("#msg").innerText = ${JSON.stringify(
            msg || "Sorry, this page was not found in this archive:",
          )};
          document.querySelector("#livelink").href = window.requestURL;
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
                wb_type: "archive-not-found",
                url: window.requestURL,
                ts: ${JSON.stringify(requestTS)},
              },
              "*",
            );
          }
        </script>
      </body>
    </html>
  `;
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
