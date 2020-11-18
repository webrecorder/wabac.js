import JSZip from 'jszip';

import { PassThrough } from 'stream';

import yaml from 'js-yaml';
import { Deflate } from 'pako';

import { json2csvAsync } from 'json-2-csv';

import { WARCRecord, WARCSerializer } from 'warcio';

import { getTSMillis, getStatusText } from './utils';



// ===========================================================================
const encoder = new TextEncoder();

const EMPTY = new Uint8Array([]);

async function* getPayload(payload) {
  yield payload;
}

// ===========================================================================
class ResumePassThrough extends PassThrough
{
  constructor(gen) {
    super();
    this.gen = gen;
  }

  resume() {
    super.resume();

    if (!this._started) {
      this.start();
      this._started = true;
    }
  }

  async start() {
    for await (const chunk of this.gen) {
      this.push(chunk);
    }

    this.push(null);
  }
}


// ===========================================================================
class Downloader
{
  constructor(db, pageList, collId, metadata) {
    this.db = db;
    this.pageList = pageList;
    this.collId = collId;
    this.metadata = metadata;

    this.offset = 0;
    this.resources = [];
    this.textResources = [];

    // compressed index
    this.indexLines = [];
    this.linesPerBlock = 2048;

    this.digestsVisted = {};
  }

  downloadWARC(filename) {
    const dl = this;

    filename = (filename || "webarchive").split(".")[0] + ".warc";

    const rs = new ReadableStream({
      start(controller) {
        dl.queueWARC(controller, filename);  
      }
    });

    const headers = {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/octet-stream"
    };

    return new Response(rs, {headers});
  }

  async queueWARC(controller, filename) {
    const metadata = await this.getMetadata();

    for await (const chunk of this.generateWARC(filename, metadata)) {
      controller.enqueue(chunk);
    }

    for await (const chunk of this.generateTextWARC(filename)) {
      controller.enqueue(chunk);
    }

    controller.close();
  }

  addFile(zip, filename, genOrString, compressed = false) {
    const data = (typeof(genOrString) === "string") ? genOrString : new ResumePassThrough(genOrString);
    zip.file(filename, data, {
      compression: compressed ? 'DEFLATE' : 'STORE',
      binary: !compressed
    });
  }

  async downloadWACZ(filename) {
    const zip = new JSZip();

    filename = (filename || "webarchive").split(".")[0] + ".wacz";

    const metadata = await this.getMetadata();

    const pages = metadata.pages;
    delete metadata.pages;
    this.addFile(zip, "pages.csv", await json2csvAsync(pages), true);

    this.addFile(zip, "webarchive.yaml", yaml.safeDump(metadata, {skipInvalid: true}), true);

    this.addFile(zip, "archive/data.warc", this.generateWARC(filename + "#/archive/data.warc"), false);
    this.addFile(zip, "archive/text.warc", this.generateTextWARC(filename + "#/archive/text.warc"), false);

    if (this.resources.length <= this.linesPerBlock) {
      this.addFile(zip, "indexes/index.cdx", this.generateCDX(), true);
    } else {
      this.addFile(zip, "indexes/index.cdx.gz", this.generateCompressedCDX("index.cdx.gz"), false);
      this.addFile(zip, "indexes/index.idx", this.generateIDX(), true);
    }

    const rs = new ReadableStream({
      start(controller) {
        zip.generateInternalStream({type:"uint8array"})
        .on('data', (data, metadata) => {
          controller.enqueue(data);
          //console.log(metadata);
        })
        .on('error', (error) => {
          console.log(error);
          controller.close();
        })
        .on('end', () => {
          controller.close();
        })
        .resume();
      }
    });

    const headers = {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/zip"
    };

    return new Response(rs, {headers});
  }

  async* generateWARC(filename, metadata)  {
    try {
      let offset = 0;

      // if filename provided, add warcinfo
      if (filename) {
        const warcinfo = await this.createWARCInfo(filename, metadata);
        yield warcinfo;
        offset += warcinfo.length;
      }

      for (const resource of this.resources) {
        resource.offset = offset;
        const records = await this.createWARCRecord(resource);
        if (!records) {
          resource.skipped = true;
          continue;
        }

        yield records[0];
        offset += records[0].length;
        resource.length = records[0].length;

        if (records.length > 1) {
          yield records[1];
          offset += records[1].length;
        }
      }
    } catch (e) {
      console.warn(e);
    }
  }

  async* generateTextWARC(filename) {
    try {
      let offset = 0;

      // if filename provided, add warcinfo
      if (filename) {
        const warcinfo = await this.createWARCInfo(filename);
        yield warcinfo;
        offset += warcinfo.length;
      }

      for (const resource of this.textResources) {
        resource.offset = offset;
        const chunk = await this.createTextWARCRecord(resource);
        yield chunk;
        offset += chunk.length;
        resource.length = chunk.length;
      }
    } catch (e) {
      console.warn(e);
    }
  }

  async* generateCDX(raw = false) {
    function getCDX(resource, filename, raw) {

      const data = {
        digest: resource.digest,
        mime: resource.mime,
        offset: resource.offset,
        length: resource.length,
        filename,
        status: resource.status
      }

      const cdx = `${resource.url} ${resource.timestamp} ${JSON.stringify(data)}\n`;

      if (!raw) {
        return cdx;
      } else {
        return [resource, cdx];
      }
    }

    try {
      for await (const resource of this.resources) {
        if (resource.skipped) {
          continue;
        }
        yield getCDX(resource, "data.warc", raw);
      }

      for await (const resource of this.textResources) {
        resource.mime = "text/plain";
        resource.status = 200;
        yield getCDX(resource, "text.warc", raw);
      }

    } catch (e) {
      console.warn(e);
    }
  }

  async* generateCompressedCDX(filename) {
    let offset = 0;

    let chunkDeflater = null;
    let count = 0;
    let key = null;

    const dl = this;

    function finishChunk() {   
      const data = chunkDeflater.result;
      const length = data.length;
  
      const idx = key + " " + JSON.stringify({offset, length, filename});

      dl.indexLines.push(idx);
  
      offset += length;
  
      chunkDeflater = null;
      count = 0;
      key = null;
  
      return data;
    }

    for await (const [resource, cdx] of this.generateCDX(true)) {
      if (!chunkDeflater) {
        chunkDeflater = new Deflate({gzip: true});
      }

      if (!key) {
        key = resource.url + " " + resource.timestamp;
      }

      if (++count === this.linesPerBlock) {
        chunkDeflater.push(cdx, true);
        yield finishChunk();
      } else {
        chunkDeflater.push(cdx);
      }
    }

    if (chunkDeflater) {
      chunkDeflater.push(EMPTY, true);
      yield finishChunk();
    }
  }

  async getMetadata() {
    if (this.pageList) {
      for await (const resource of this.db.resourcesByPages(this.pageList)) {
        this.resources.push(resource);
      }
    } else {
      this.resources = await this.db.db.getAll("resources");  
    }

    const metadata = {...this.metadata};

    metadata.pages = [];

    const pageIter = this.pageList ? await this.db.getPages(this.pageList) : await this.db.getAllPages();

    for (const page of pageIter) {
      const {url, ts, title, id, text, favIconUrl} = page;
      const date = new Date(ts).toISOString();
      const pageData = {title, url, date, id};
      if (favIconUrl) {
        pageData.favIconUrl = favIconUrl;
      }
      metadata.pages.push(pageData);

      if (page.text) {
        this.textResources.push({url, ts, text});
      }
    }

    metadata.pageLists = await this.db.getAllCuratedByList();

    metadata.config = {useSurt: false, decodeResponses: false};

    return metadata;
  }

  async getLists() {
    try {
      const lists = await this.db.getAllCuratedByList();
      console.log(lists);
      return yaml.safeDump(lists, {skipInvalid: true});
    } catch (e) {
      console.log(e);
    }
  }

  async* generateIDX() {
    yield this.indexLines.join("\n");
  }

  async createWARCInfo(filename, metadata) {
    const warcVersion = "WARC/1.1";
    const type = "warcinfo";

    const info = {
      "software": "Webrecorder wabac.js/warcio.js",
      "format": "WARC File Format 1.1",
      "isPartOf": this.metadata.title || this.collId,
    };

    if (metadata) {
      info["json-metadata"] = JSON.stringify(metadata);
    }

    const record = await WARCRecord.createWARCInfo({filename, type, warcVersion}, info);
    const buffer = await WARCSerializer.serialize(record, {gzip: true});
    return buffer;
  }

  async createWARCRecord(resource) {
    const url = resource.url;
    const date = new Date(resource.ts).toISOString();
    resource.timestamp = getTSMillis(date);
    const httpHeaders = resource.respHeaders;
    const warcVersion = "WARC/1.1";

    const pageId = resource.pageId;

    const warcHeaders = {"WARC-Page-ID": pageId};

    if (resource.extraOpts && Object.keys(resource.extraOpts).length) {
      warcHeaders["WARC-JSON-Metadata"] = JSON.stringify(resource.extraOpts);
    }

    if (resource.digest) {
      warcHeaders["WARC-Payload-Digest"] = resource.digest;
    }

    let payload = resource.payload;
    let type = null;

    let refersToUrl, refersToDate;

    const digestOriginal = this.digestsVisted[resource.digest];

    if (resource.digest && digestOriginal) {

      // if exact resource in a row, and same page, then just skip instead of writing revisit
      if (url === this.lastUrl && pageId === this.lastPageId) {
        //console.log("Skip Dupe: " + url);
        return null;
      }

      type = "revisit";
      resource.mime = "warc/revisit";
      payload = EMPTY;

      refersToUrl = digestOriginal.url;
      refersToDate = digestOriginal.date;

    } else if (resource.origURL && resource.origTS) {
      if (!resource.digest) {
        //console.log("Skip fuzzy resource with no digest");
        return null;
      }

      type = "revisit";
      resource.mime = "warc/revisit";
      payload = EMPTY;

      refersToUrl = resource.origURL;
      refersToDate = resource.origTS;

    } else {
      type = "response";
      if (!payload) {
        payload = await this.db.loadPayload(resource);
      }

      if (!payload) {
        //console.log("Skipping No Payload For: " + url, resource);
        return null;
      }

      this.digestsVisted[resource.digest] = {url, date};
    }

    const status = resource.status || 200;
    const statusText = resource.statusText || getStatusText(status);

    const statusline = `HTTP/1.1 ${status} ${statusText}`;

    const record = await WARCRecord.create({
      url, date, type, warcVersion, warcHeaders, statusline, httpHeaders,
      refersToUrl, refersToDate}, getPayload(payload));

    const buffer = await WARCSerializer.serialize(record, {gzip: true});
    if (!resource.digest) {
      resource.digest = record.warcPayloadDigest;
    }

    this.lastPageId = pageId;
    this.lastUrl = url;

    const records = [buffer];

    if (resource.reqHeaders) {
      const reqWarcHeaders = {
        "WARC-Page-ID": pageId,
        "WARC-Concurrent-To": record.warcHeader("WARC-Record-ID")
      };

      const method = resource.method || "GET";
      const urlParsed = new URL(url);
      const statusline = method + " " + url.slice(urlParsed.origin.length);

      const reqRecord = await WARCRecord.create({
        url, date, warcVersion,
        type: "request",
        warcHeaders: reqWarcHeaders,
        httpHeaders: resource.reqHeaders,
        statusline,
      }, getPayload(new Uint8Array([])));

      records.push(await WARCSerializer.serialize(reqRecord, {gzip: true}));
    }

    return records;
  }

  async createTextWARCRecord(resource) {
    const date = new Date(resource.ts).toISOString();
    const timestamp = getTSMillis(date);
    resource.timestamp = timestamp;
    const url = `urn:text:${timestamp}/${resource.url}`;
    resource.url = url;

    const type = "resource";
    const warcHeaders = {"Content-Type": 'text/plain; charset="UTF-8"'};
    const warcVersion = "WARC/1.1";

    const payload = getPayload(encoder.encode(resource.text));

    const record = await WARCRecord.create({url, date, warcHeaders, warcVersion, type}, payload);

    const buffer = await WARCSerializer.serialize(record, {gzip: true});
    if (!resource.digest) {
      resource.digest = record.warcPayloadDigest;
    }
    return buffer;
  }
}

export { Downloader };

