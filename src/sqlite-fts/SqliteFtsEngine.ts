// @ts-expect-error
import SQLiteESMFactory from "./vendor/wa-sqlite-async.mjs";

import * as SQLite from "wa-sqlite";
import * as SQLITE from "wa-sqlite/src/sqlite-constants.js";
import { HttpVFS } from "./HttpVFS";
import { HttpVfsProgressEvent } from "./LazyUint8Array.js";
type SqliteFtsConfig = {
  url: string;
  startOffset: number;
  length: number;
  pageSize: number;
};

type SearchResponse =
  | {
      type: "progress";
      progress: HttpVfsProgressEvent;
    }
  | {
      type: "row";
      row: any;
    }
  | { type: "error"; message: string };
export class SqliteFtsEngine {
  private readonly config: SqliteFtsConfig;
  private sqlite3: SQLiteAPI | null = null;
  private db: number | null = null; // pointer to database
  private progressStream = new ProgressStream();
  private queryIsRunning = false;
  constructor(config: SqliteFtsConfig) {
    console.log("new SqliteFtsEngine", config);
    this.config = config;
  }
  async initDb() {
    if (!this.sqlite3 || !this.db) {
      const module = await SQLiteESMFactory();
      this.sqlite3 = SQLite.Factory(module);
      this.sqlite3.vfs_register(
        new HttpVFS("httpvfs", this.config, (progress) =>
          this.progressStream.setProgress(progress)
        )
      );
      const db = await this.sqlite3.open_v2("dummy", undefined, "httpvfs");
      this.db = db;
      console.log("opened db successfully");
    }
    Object.assign(globalThis, { sqlite3: this.sqlite3, db: this.db }); // for debugging
    return { sqlite3: this.sqlite3, db: this.db };
  }

  async search(matchString: string): Promise<ReadableStream> {
    const results = this
      .sql`select *, snippet(pages_fts, -1, '<b>', '</b>', '...', 32) from pages_fts where pages_fts match ${matchString} limit ${10}`;

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        console.log("[stream] pulling from stream!");
        let value;
        try {
          const res = await results.next();
          if (res.done) {
            console.log("[stream] done!");
            controller.close();
            return;
          }
          value = res.value;
        } catch (e) {
          console.error("error while reading query response", e);
          value = { type: "error", message: String(e) };
        }
        const text = JSON.stringify(value) + "\n";
        controller.enqueue(new TextEncoder().encode(text));
      },
    });
  }
  private async *sql(
    strings: TemplateStringsArray,
    ...insertions: (string | number)[]
  ): AsyncIterator<SearchResponse> {
    if (this.queryIsRunning) throw Error("a query is already running");
    this.queryIsRunning = true;
    try {
      const assembledExpression = strings.join("?");
      const { sqlite3, db } = await this.initDb();
      const str = sqlite3.str_new(db, assembledExpression);
      const prepared = await sqlite3.prepare_v2(db, sqlite3.str_value(str));
      if (!prepared) throw Error("statement could not be prepared");
      console.log(`sql: ${assembledExpression} ${JSON.stringify(insertions)}`);
      sqlite3.bind_collection(prepared.stmt, insertions);
      const columns = sqlite3.column_names(prepared.stmt);
      let sqlitestep = sqlite3.step(prepared.stmt);
      while (true) {
        const resp = await Promise.race([
          this.progressStream.haveProgressEvent,
          sqlitestep,
        ]);
        yield* this.progressStream.consume().map(progress => ({ type: "progress" as const, progress }));
        if (resp === "progress") {
          continue;
        }
        if (resp === SQLITE.SQLITE_DONE) {
          sqlite3.finalize(prepared.stmt);
          break;
        }
        if (resp === SQLITE.SQLITE_ROW) {
          const row = sqlite3.row(prepared.stmt);
          yield {
            type: "row",
            row: Object.fromEntries(columns.map((c, i) => [c, row[i]])),
          };
          sqlitestep = sqlite3.step(prepared.stmt);
          continue;
        }
        throw Error("unknown sqlite state " + resp);
      }
    } finally {
      this.queryIsRunning = false;
    }
  }
}

class ProgressStream {
  haveProgressEvent!: Promise<"progress">;
  private progressEvents: HttpVfsProgressEvent[] = [];
  private sendHaveProgressEvent!: () => void;
  constructor() {
    this.newNextProgressEvent();
  }
  private newNextProgressEvent() {
    this.haveProgressEvent = new Promise(
      (r) => {
        this.sendHaveProgressEvent = () => r("progress");
      }
    );
  }
  consume(): HttpVfsProgressEvent[] {
    return this.progressEvents.splice(0, this.progressEvents.length);
  }
  setProgress(p: HttpVfsProgressEvent) {
    console.log("SET PROGRESS", p);
    this.progressEvents.push(p);
    this.sendHaveProgressEvent();
    this.newNextProgressEvent();
  }
}
