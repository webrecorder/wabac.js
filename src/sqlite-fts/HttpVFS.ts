import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import * as SQLite from "wa-sqlite";
import { Base } from "wa-sqlite/src/VFS.js";
import * as SQLITE from "wa-sqlite/src/sqlite-constants.js";
import { LazyUint8Array, HttpVfsProgressEvent } from "./LazyUint8Array";
type SqliteFtsConfig = {
  url: string;
  startOffset: number;
  length: number;
  pageSize: number;
};

export class HttpVFS extends Base {
  name: string;
  config: SqliteFtsConfig;
  dbFileId: number = 0;
  dbFile: LazyUint8Array;

  constructor(
    name: string,
    config: SqliteFtsConfig,
    progressCallback: (p: HttpVfsProgressEvent) => void
  ) {
    super();
    this.name = name;
    this.config = config;
    this.dbFile = new LazyUint8Array({
      fileLength: config.length,
      requestChunkSize: config.pageSize,
      progressCallback,
      rangeMapper: (from, to) => ({
        url: config.url,
        fromByte: config.startOffset + from,
        toByte: config.startOffset + to,
      }),
    });
  }
  xClose(fileId: number): number | Promise<number> {
    if (fileId !== this.dbFileId) throw Error("unknown file id " + fileId);
    return SQLITE.SQLITE_OK;
  }
  xRead(
    fileId: number,
    pData: { size: number; value: Int8Array },
    iOffset: number
  ): number | Promise<number> {
    return this.handleAsync(async () => {
      if (fileId !== this.dbFileId)
        throw Error("xRead: invalid file id " + fileId);
      const uint8Array = new Uint8Array(
        pData.value.buffer,
        pData.value.byteOffset,
        pData.value.length
      );
      await this.dbFile.copyInto(uint8Array, 0, pData.size, iOffset);

      return SQLITE.SQLITE_OK;
    });
  }
  xWrite(
    fileId: number,
    pData: { size: number; value: Int8Array },
    iOffset: number
  ): number | Promise<number> {
    throw new Error("xWrite not implemented.");
  }
  xTruncate(fileId: number, iSize: number): number | Promise<number> {
    throw new Error("xTruncate not implemented.");
  }
  xSync(fileId: number, flags: number): number | Promise<number> {
    throw new Error("xSync not implemented.");
  }
  xFileSize(
    fileId: number,
    pSize64: { set(value: number): void }
  ): number | Promise<number> {
    if (fileId !== this.dbFileId)
      throw new Error(`xFileSize: invalid file id ${fileId}`);
    pSize64.set(this.config.length);
    return SQLITE.SQLITE_OK;
  }
  xLock(fileId: number, flags: number): number | Promise<number> {
    return SQLITE.SQLITE_OK;
  }
  xUnlock(fileId: number, flags: number): number | Promise<number> {
    return SQLITE.SQLITE_OK;
  }
  xCheckReservedLock(
    fileId: number,
    pResOut: { set(value: number): void }
  ): number | Promise<number> {
    throw new Error("xCheckReservedLockMethod not implemented.");
  }
  xFileControl(
    fileId: number,
    flags: number,
    pOut: { value: Int8Array }
  ): number | Promise<number> {
    return SQLITE.SQLITE_NOTFOUND;
  }
  xDeviceCharacteristics(fileId: number): number | Promise<number> {
    return SQLITE.SQLITE_OK;
  }
  xOpen(
    name: string | null,
    fileId: number,
    flags: number,
    pOutFlags: { set(value: number): void }
  ): number | Promise<number> {
    if (name !== "dummy") throw Error("file name must be dummy");
    this.dbFileId = fileId;
    pOutFlags.set(flags);
    return SQLITE.SQLITE_OK;
  }
  xDelete(name: string, syncDir: number): number | Promise<number> {
    throw new Error("xDelete not implemented.");
  }
  xAccess(
    name: string,
    flags: number,
    pResOut: { set(value: any): void }
  ): number | Promise<number> {
    if (["dummy-journal", "dummy-wal"].includes(name)) {
      pResOut.set(0);
      return SQLITE.SQLITE_OK;
    }
    throw new Error(`xAccess(${name}, ${flags}) not implemented.`);
  }
}
