// this is a standalone nodejs script
import fs from "fs";
import Database from "better-sqlite3";

const pagesJson = process.argv[2];
if (!pagesJson) throw Error(`usage: create-sqlite-fts pagesJson`);

const content = fs
  .readFileSync(pagesJson, { encoding: "utf8" })
  .trim()
  .split("\n")
  .slice(1) // skip first line
  .map((e) => JSON.parse(e));
const pagesSqlite = pagesJson.replace(".jsonl", "-fts.sqlite3");
const db = new Database(pagesSqlite);

// todo: this is somewhat specific to english language, maybe also try trigram
// todo: change pgsz option?
const pageSize = 32768;
const ftsPageSize = Math.round(4050 / 4096 * pageSize);
db.exec(`
pragma page_size = ${ftsPageSize}; -- trade off of number of requests that need to be made vs overhead. 
pragma journal_mode = WAL;
pragma synchronous = OFF;
create virtual table pages_fts using fts5(
    id UNINDEXED,
    url UNINDEXED,
    ts UNINDEXED,
    title,
    text,
    tokenize = 'porter unicode61'
);
insert into pages_fts(pages_fts, rank) values ('pgsz', ${ftsPageSize});
`);

const ins = db.prepare(
  `insert into pages_fts (id, url, ts, title, text) values (:id, :url, :ts, :title, :text)`
);
for (const entry of content) {
  const entryWithDefaults = {
    url: null,
    title: null,
    ...entry,
  };
  try {
    ins.run(entryWithDefaults);
  } catch (e: unknown) {
    (e as any).context = entryWithDefaults;
    throw e;
  }
}
db.exec(`
insert into pages_fts(pages_fts) values ('optimize'); -- for every FTS table you have (if you have any)
pragma journal_mode = DELETE;
vacuum; -- reorganize database and apply changed page size
`);


// todo: select *, snippet(pages_fts, -1, '[[', ']]', '...', 32) from pages_fts where pages_fts match 'hello';