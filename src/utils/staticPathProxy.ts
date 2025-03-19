export const staticPathProxy =
  (proxyPrefix: string, fetch: typeof self.fetch = self.fetch) =>
  async (url: string, request: Request) => {
    const method = request.method;
    const headers = new Headers(request.headers);
    // Because of CORS restrictions, the request cannot be a ReadableStream, so instead we get it as a string.
    // If in the future we need to support streaming, we can revisit this — there may be a way to get it to work.
    const body = await request.arrayBuffer();

    url = url.slice(proxyPrefix.length);
    const urlObj = new URL(url, self.location.href);
    url = urlObj.href;

    const requestInit: RequestInit = {
      cache: "no-store",
      headers,
      method,
      ...(method !== "GET" && { body }),
    };

    return fetch(url, requestInit);
  };
