/* eslint-env node */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import webpack from "webpack";

const chrome = process.env.CHROME_BINARY;
if (!chrome)
  throw new Error("Set CHROME_BINARY to a Chromium or Chrome executable");
const project = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = fileURLToPath(new URL("./", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "wabac-alias-browser-"));
const profile = join(root, "profile");
const compiler = webpack({
  mode: "development",
  target: "webworker",
  entry: join(fixtures, "x-graphql-alias-worker.ts"),
  output: { path: root, filename: "worker.js" },
  resolve: { extensions: [".ts", ".js"] },
  plugins: [new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] })],
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: "ts-loader",
        options: {
          transpileOnly: true,
          compilerOptions: { declarationMap: false },
          configFile: join(project, "tsconfig.json"),
        },
      },
    ],
  },
});
await new Promise((resolve, reject) =>
  compiler.run((error, stats) => {
    compiler.close(() => {});
    if (error || stats.hasErrors())
      reject(error || new Error(stats.toString()));
    else resolve();
  }),
);
const server = createServer(async (req, res) => {
  const names = {
    "/": join(fixtures, "x-graphql-alias.html"),
    "/worker.js": join(root, "worker.js"),
  };
  const name = names[req.url];
  if (!name) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".html")
        ? "text/html"
        : "application/octet-stream",
  );
  res.end(await readFile(name));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const child = spawn(
  chrome,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let sock;
try {
  const browserURL = await new Promise((resolve, reject) => {
    let text = "";
    child.stderr.on("data", (data) => {
      text += data;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    child.on("exit", (code) => reject(new Error(`Chrome exited ${code}`)));
  });
  const response = await fetch(
    browserURL
      .replace("ws:", "http:")
      .replace(/\/devtools\/browser\/.*/, "/json/list"),
  );
  const target = (await response.json()).find(
    (target) => target.type === "page" && target.url === "about:blank",
  );
  sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) =>
    sock.addEventListener("open", resolve, { once: true }),
  );
  let next = 0;
  const pending = new Map();
  sock.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(msg.error) : p.resolve(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      sock.send(JSON.stringify({ id, method, params }));
    });
  sock.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Runtime.exceptionThrown")
      console.error(JSON.stringify(msg.params));
  });
  sock.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Runtime.consoleAPICalled")
      console.error(
        JSON.stringify(
          msg.params.args.map((arg) => arg.value ?? arg.description),
        ),
      );
  });
  await send("Runtime.enable");
  await send("Page.enable");
  const loaded = new Promise((resolve) =>
    sock.addEventListener("message", function listener(e) {
      if (JSON.parse(e.data).method === "Page.loadEventFired") {
        sock.removeEventListener("message", listener);
        resolve();
      }
    }),
  );
  await send("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}/`,
  });
  await loaded;
  const result = await send("Runtime.evaluate", {
    expression: "window.verifyExport()",
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result.value));
} finally {
  sock?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  server.close();
  await rm(root, { recursive: true, force: true });
}
