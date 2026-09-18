import { ArchiveDB } from "../../src/archivedb.ts";
import { ArchiveRequest } from "../../src/request.ts";

const worker = self as ServiceWorkerGlobalScope;

worker.addEventListener("install", (event) =>
  event.waitUntil(worker.skipWaiting()),
);
worker.addEventListener("activate", (event) =>
  event.waitUntil(worker.clients.claim()),
);
worker.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname !== "/probe") return;
  event.respondWith(
    (async () => {
      const db = new ArchiveDB("alias-regression-" + crypto.randomUUID());
      try {
        await db.initing;
        const rows = JSON.parse(url.searchParams.get("rows")!) as {
          url: string;
          source: string;
        }[];
        const ts = Date.parse("2026-01-01T00:00:00Z");
        for (const row of rows) {
          await db.addResource({
            url: row.url,
            ts,
            status: 200,
            mime: "application/json",
            payload: new TextEncoder().encode(
              JSON.stringify({ source: row.source }),
            ),
            respHeaders: { "content-type": "application/json" },
          });
        }
        const target = url.searchParams.get("target")!;
        const request = new ArchiveRequest(target, event.request, {
          ts: "20260101000000",
        });
        const response = await db.getResource(request, "/replay/", event);
        return response
          ? response instanceof Response
            ? response
            : response.makeResponse()
          : new Response("Missing", { status: 404 });
      } finally {
        await db.delete();
      }
    })(),
  );
});
