export const staticPathProxy =
  (proxyPrefix: string) => async (url: string, request: Request) => {
    const method = request.method;
    const headers = new Headers(request.headers);
    const body = request.body;
    const mode = request.mode;

    url = url.slice(proxyPrefix.length);
    const urlObj = new URL(url, self.location.href);
    url = urlObj.href;

    headers.set("Host", urlObj.host);

    return self.fetch(request, {
      cache: "no-store",
      headers,
      method,
      body,
      mode,
    });
  };
