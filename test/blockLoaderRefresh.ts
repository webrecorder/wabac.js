import test from "ava";

import { createLoader } from "../src/blockloaders.js";
import { AccessDeniedError, RangeError } from "../src/utils.js";

const OLD_URL = "https://r2.example/coll.wacz?sig=expired";
const NEW_URL = "https://r2.example/coll.wacz?sig=fresh";
const REFRESH_ENDPOINT = "https://app.example/resign";
const PAYLOAD = new Uint8Array([1, 2, 3]);

type FetchCall = { url: string; range: string | null };

// How the expired (old) URL fails when fetched:
//  - "resolve403":      fetch() resolves with a readable 403 (same-origin, or a
//                       store that puts CORS headers on the error response).
//  - "rejectTypeError": fetch() rejects with a TypeError — the real R2 case,
//                       where the expiry 403 carries no CORS headers so the
//                       browser blocks it and the status is unreadable.
//  - "rejectPlainError": a non-fetch failure reaching the same catch, e.g.
//                       retryFetch giving up after 429/503 (throws a plain
//                       Error, not a TypeError).
type OldUrlMode = "resolve403" | "rejectTypeError" | "rejectPlainError";

// Install a fetch stub that fails the expired URL, hands back a fresh URL from
// the refresh endpoint, and serves a 206 range from the fresh URL. Set
// refreshFails to make the refresh endpoint itself reject, as AbortSignal.timeout
// does when the endpoint hangs past REFRESH_TIMEOUT_MS.
function installFetchStub({
  oldUrl = "resolve403",
  refreshFails = false,
}: { oldUrl?: OldUrlMode; refreshFails?: boolean } = {}) {
  const calls: FetchCall[] = [];
  const orig = globalThis.fetch;

  globalThis.fetch = (async (url: string, opts?: RequestInit) => {
    const headers = new Headers(opts?.headers);
    calls.push({ url, range: headers.get("Range") });

    // emulate fetch() rejecting on an already-aborted signal
    if (opts?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    if (url === REFRESH_ENDPOINT) {
      if (refreshFails) {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      return new Response(JSON.stringify({ url: NEW_URL }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === OLD_URL) {
      switch (oldUrl) {
        case "rejectTypeError":
          throw new TypeError("Failed to fetch");
        case "rejectPlainError":
          throw new Error("retryFetch failed");
        default:
          return new Response(null, { status: 403 });
      }
    }
    if (url === NEW_URL) {
      return new Response(PAYLOAD, {
        status: 206,
        headers: { "Content-Range": `bytes 0-2/3` },
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = orig) };
}

test.serial(
  "getRange refreshes a readable (403) signed URL and retries seamlessly",
  async (t) => {
    const { calls, restore } = installFetchStub();
    try {
      const loader = await createLoader({
        url: OLD_URL,
        refreshUrlEndpoint: REFRESH_ENDPOINT,
      });

      const res = (await loader.getRange(0, 3, false)) as Uint8Array;

      t.deepEqual(Array.from(res), [1, 2, 3]);

      const urls = calls.map((c) => c.url);
      // expired URL tried first, then the refresh endpoint, then the fresh URL
      t.deepEqual(urls, [OLD_URL, REFRESH_ENDPOINT, NEW_URL]);
    } finally {
      restore();
    }
  },
);

test.serial(
  "getRange refreshes an opaque (fetch-rejecting) 403 and retries seamlessly",
  async (t) => {
    // The real R2 case: the expiry 403 has no CORS headers, so fetch() rejects
    // with an opaque TypeError rather than resolving with a readable 403.
    const { calls, restore } = installFetchStub({ oldUrl: "rejectTypeError" });
    try {
      const loader = await createLoader({
        url: OLD_URL,
        refreshUrlEndpoint: REFRESH_ENDPOINT,
      });

      const res = (await loader.getRange(0, 3, false)) as Uint8Array;

      t.deepEqual(Array.from(res), [1, 2, 3]);
      t.deepEqual(
        calls.map((c) => c.url),
        [OLD_URL, REFRESH_ENDPOINT, NEW_URL],
      );
    } finally {
      restore();
    }
  },
);

test.serial(
  "getRange does not re-sign a request the caller aborted",
  async (t) => {
    const { calls, restore } = installFetchStub({ oldUrl: "rejectTypeError" });
    try {
      const loader = await createLoader({
        url: OLD_URL,
        refreshUrlEndpoint: REFRESH_ENDPOINT,
      });

      const controller = new AbortController();
      controller.abort();

      let caught: unknown;
      try {
        await loader.getRange(0, 3, false, controller.signal);
      } catch (e) {
        caught = e;
      }

      // the abort is surfaced unchanged, not masked as access-denied...
      t.true(caught instanceof DOMException && caught.name === "AbortError");
      // ...and no re-sign was attempted
      t.false(calls.some((c) => c.url === REFRESH_ENDPOINT));
    } finally {
      restore();
    }
  },
);

test.serial(
  "getRange does not re-sign on a non-fetch (non-TypeError) failure",
  async (t) => {
    // e.g. retryFetch exhausting its 429/503 retries throws a plain Error; that
    // must surface as RangeError, not trigger a spurious re-sign.
    const { calls, restore } = installFetchStub({ oldUrl: "rejectPlainError" });
    try {
      const loader = await createLoader({
        url: OLD_URL,
        refreshUrlEndpoint: REFRESH_ENDPOINT,
      });

      let caught: unknown;
      try {
        await loader.getRange(0, 3, false);
      } catch (e) {
        caught = e;
      }

      t.true(caught instanceof RangeError);
      t.false(caught instanceof AccessDeniedError);
      t.false(calls.some((c) => c.url === REFRESH_ENDPOINT));
    } finally {
      restore();
    }
  },
);

test.serial(
  "getRange without a refresh endpoint surfaces AccessDeniedError on 403",
  async (t) => {
    const { calls, restore } = installFetchStub();
    try {
      const loader = await createLoader({ url: OLD_URL });

      // Catch locally: AccessDeniedError.info carries a Response, which ava
      // cannot structured-clone across its worker channel if handed to it.
      let caught: unknown;
      try {
        await loader.getRange(0, 3, false);
      } catch (e) {
        caught = e;
      }
      t.true(caught instanceof AccessDeniedError);

      // only the expired URL is hit; no refresh attempted
      t.deepEqual(
        calls.map((c) => c.url),
        [OLD_URL],
      );
    } finally {
      restore();
    }
  },
);

test.serial(
  "getRange surfaces the original error when the refresh endpoint fails",
  async (t) => {
    // A hung endpoint rejects via AbortSignal.timeout; the failed refresh must
    // surface the original AccessDeniedError, not hang or retry the range.
    const { calls, restore } = installFetchStub({
      oldUrl: "rejectTypeError",
      refreshFails: true,
    });
    try {
      const loader = await createLoader({
        url: OLD_URL,
        refreshUrlEndpoint: REFRESH_ENDPOINT,
      });

      let caught: unknown;
      try {
        await loader.getRange(0, 3, false);
      } catch (e) {
        caught = e;
      }

      t.true(caught instanceof AccessDeniedError);
      // refresh was attempted but the fresh URL was never fetched
      t.deepEqual(
        calls.map((c) => c.url),
        [OLD_URL, REFRESH_ENDPOINT],
      );
    } finally {
      restore();
    }
  },
);
