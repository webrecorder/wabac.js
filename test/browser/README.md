# Browser integration checks

The X GraphQL alias regression runs the real `ArchiveDB.getResource()` implementation in a Chromium service worker, with actual FetchEvents and IndexedDB. It creates an isolated browser profile and temporary database rows containing only test strings. It does not contact X or need a login, cookies, or a saved user archive.

After installing the repository's dependencies, run from the repository root with Node.js 22 or newer:

```sh
CHROME_BINARY=/path/to/chrome node test/browser/x-graphql-alias.js
```

It verifies the missing-origin fallback, exact matches for both origins at the same timestamp in either insertion order, and rejection of different queries, operations, hosts, unrelated paths, and POST requests. The existing `test/testDB.ts` uses an IndexedDB substitute; this check intentionally exercises the browser implementation instead.
