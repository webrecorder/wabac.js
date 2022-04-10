// this is a standalone nodejs script. run via `yarn ts-node --project tsconfig.node.json src/sqlite-fts/create-sqlite-fts.ts .../extraPages.jsonl`
import fs from "fs";
import Database from "better-sqlite3";

const mode: "minimal" | "full" = "minimal"; // if minimal: create a contentless table without columnsize and with detail=none
const pageSize = 4096;
const pagesJson = process.argv[2];
if (!pagesJson) throw Error(`usage: create-sqlite-fts pagesJson`);

const content = fs
  .readFileSync(pagesJson, { encoding: "utf8" })
  .trim()
  .split("\n")
  .slice(1) // skip first line
  .map((e) => JSON.parse(e));
const pagesSqlite = pagesJson.replace(".jsonl", "-fts.sqlite3");
console.log("writing result to", pagesSqlite);
const db = new Database(pagesSqlite);

// todo: this is somewhat specific to english language, maybe also try trigram
// todo: change pgsz option?

const ftsPageSize = Math.round((4050 / 4096) * pageSize); //
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
    ${mode === "minimal" ? ", content='pages', columnsize=0, detail=none" : ""}
);
insert into pages_fts(pages_fts, rank) values ('pgsz', ${ftsPageSize});
`);

let insert;
if (mode === "minimal") {
  // create separate table with the data to prevent sqlite from storing the title and text
  db.exec(`
  create table pages(id text, url text, ts text, title text, text text);
  `);

  const insContent = db.prepare(
    `insert into pages (id, url, ts, title, text) values (:id, :url, :ts, :title, :text)`
  );
  const insFts = db.prepare(
    `insert into pages_fts (rowid, id, url, ts, title, text) values ((select rowid from pages where id = :id), :id, :url, :ts, :title, :text)`
  );
  insert = (data: any) => {
    const res = insContent.run({ ...data, ts: null, text: null });
    insFts.run({ ...data, rowid: res.lastInsertRowid });
  };
} else {
  const insQuery = db.prepare(
    `insert into pages_fts (id, url, ts, title, text) values (:id, :url, :ts, :title, :text)`
  );
  insert = (data: any) => insQuery.run(data);
}

for (const entry of content) {
  const entryWithDefaults = {
    url: null,
    title: null,
    ...entry,
  };
  try {
    insert(entryWithDefaults);
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
