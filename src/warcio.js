import { Inflate } from 'pako';


// ===========================================================================
class NoConcatInflator extends Inflate
{
  onEnd(status) {
    this.err = status;
  } 
}

// ===========================================================================
class StreamReader {
  constructor(stream, compressed = true) {
    this.inflator = new NoConcatInflator();
    this.stream = stream;
    this.lastValue = null;

    this.done = false;

    this._savedChunk = null;

    this.compressed = compressed;

    this.offset = 0;
  }

  async _loadNext()  {
    const res = await this.stream.read();
    this.done = res.done;
    return res.value;
  }

  unread(chunk) {
    if (!chunk) {
      return;
    }

    if (this._savedChunk) {
      console.log('Already have chunk!');
    }

    this._savedChunk = chunk;
    this.done = false;
  }

  async read() {
    const value = await this._read();
    return {value, done: !value};
  }

  async _read() {
    if (this.done) {
      return null;
    }

    if (this._savedChunk) {
      const chunk = this._savedChunk;
      this._savedChunk = null;
      return chunk;
    }

    if (this.compressed) {
      const newValue = this._getNextChunk();
      if (newValue) {
        return newValue;
      }
    }

    let value = await this._loadNext();


    while (this.compressed && !this.done) {
      this._push(value);

      const newValue = this._getNextChunk(value);
      if (newValue) {
        return newValue;
      }
      value = await this._loadNext();
    }

    return value;
  }

  _push(value) {
    this.lastValue = value;

    if (this.inflator.ended) {
      this.inflator = new NoConcatInflator();
    }
    this.inflator.push(value);
  }

  _getNextChunk(original) {
    while (true) {
      if (this.inflator.chunks.length > 0) {
        return this.inflator.chunks.shift();
      }

      if (this.inflator.ended) {
        if (this.inflator.err !== 0)  {          
          //console.log("err: " + this.inflator.err);
          // assume not compressed
          this.compressed = false;
          //if (original) {
            //this.offset += original.length;
          //}
          return original;
        }

        const avail_in = this.inflator.strm.avail_in;

        this.offset += this.inflator.strm.total_in;

        if (avail_in && this.lastValue) {
          this._push(this.lastValue.slice(-avail_in));
          continue;
        }
      }

      return null;
    }
  }

  async* iterChunks() {
    let chunk = null;
    while (chunk = await this._read()) {
      yield chunk;
    }
  }

  async* iterLines() {
    let line = null;
    while (line = await this.readline()) {
      yield line;
    }
  }

  async readline() {
    if (this.done) {
      return "";
    }

    let inx = -1;
    const chunks = [];

    let size = 0;
    let chunk;

    while ((chunk = await this._read()) && ((inx = chunk.indexOf(10)) < 0)) {
      chunks.push(chunk);
      size += chunk.byteLength;
    }

    if (chunk) {
      const [first, remainder] = splitChunk(chunk, inx + 1);
      chunks.push(first);
      size += first.byteLength;
      chunk = remainder;
    }

    if (!chunk) {// || (!this.compressed && !chunk.length)) {
      this._savedChunk = null;
      this.done = true;
    } else if (!chunk.length) {
      this._savedChunk = null;
    } else {
      this._savedChunk = chunk;
    }

    if (!chunks.length) {
      return "";
    }

    const buff = concatChunks(chunks, size);

    this.offset += size;

    return new TextDecoder("utf-8").decode(buff);
  }

  readFully() {
    return this.readSize();
  }

  async readSize(sizeLimit = -1) {
    const chunks = [];

    let size = 0;

    let chunk;

    while (chunk = await this._read()) {
      if (sizeLimit >= 0) {
        if (chunk.length > sizeLimit) {
          const [first, remainder] = splitChunk(chunk, sizeLimit);
          chunks.push(first);
          size += first.byteLength;
          if (remainder.length > 0) {
            this._savedChunk = remainder;
          }
          break;
        } else {
          sizeLimit -= chunk.length;
        }
      }
      chunks.push(chunk);
      size += chunk.byteLength;
    }

    return concatChunks(chunks, size);
  }

  getOffset() {
    return this.offset;
  }
}


// ===========================================================================
class LimitReader
{
  constructor(stream, limit = -1, skip = 0) {
    this.stream = stream;
    this.length = limit;
    this.limit = limit;
    this.skip = 0;
  }

  setLimitSkip(limit = -1, skip = 0) {
    this.limit = limit;
    this.skip = skip;
  }

  async read() {
    if (this.limit === 0) {
      return {done: true, value: null};
    }

    //let chunk = await this.stream.read();
    let res;
    let chunk;

    while ((res = await this.stream.read()) && (chunk = res.value) && (this.skip > 0)) {
      if (chunk.length > this.skip) {
        const [first, remainder] = splitChunk(chunk, this.skip);
        chunk = remainder;
        this.skip = 0;
      } else {
        this.skip -= chunk.length;
      }
    }

    if (this.limit > 0 && chunk) {
      if (chunk.length > this.limit) {
        const [first, remainder] = splitChunk(chunk, this.limit);
        chunk = first;

        if (remainder.length > 0) {
          this.stream.unread(remainder);
        }
      }
      this.limit -= chunk.length;
    }

    return {done: !chunk, value: chunk}
  }

  async readFully() {
    const chunks = [];

    let size = 0;

    let res;
    let chunk;

    while (res = await this.read(), chunk = res.value) {
      chunks.push(chunk);
      size += chunk.byteLength;
    }

    return concatChunks(chunks, size);
  }
}


// ===========================================================================
function splitChunk(chunk, inx) {
  return [chunk.slice(0, inx), chunk.slice(inx)];
}


// ===========================================================================
function concatChunks(chunks, size) {
  const buffer = new Uint8Array(size);

  let offset = 0;

  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return buffer;
}


// ===========================================================================
class StatusAndHeaders {
  constructor({statusline, headers, protocol = "", statusText = ""}) {
    this.statusline = statusline;
    this.headers = headers;
    this.protocol = protocol;
    this.statusText = statusText;
  }

  toString() {
    const buff = [this.statusline];

    for (const [name, value] of this.headers) {
      buff.push(`${name}: ${value}`);
    }

    return buff.join('\r\n') + '\r\n';
  }

  statusCode() {
    return Number(this.statusline.split(" ", 1)[0]) || 200;
  }
}

// ===========================================================================
class StatusAndHeadersParser {
  split(str, sep, limit) {
    const parts = str.split(sep);
    const newParts = parts.slice(0, limit);
    newParts.push(parts.slice(limit).join(sep));
    return newParts;
  }

  startsWithSpace(line) {
    const first = line.charAt(0);
    return first === " " || first === "\t";
  }

  async parse(stream, {fullStatusLine = null, headersClass = Map} = {}) {
    if (!fullStatusLine) {
      fullStatusLine = await stream.readline();
    }

    if (!fullStatusLine) {
      return null;
    }

    let statusline = fullStatusLine.trimEnd();

    const headers = new headersClass();

    if (!statusline) {
      return new StatusAndHeaders({statusline, headers, totalRead: this.totalRead});
    }

    let [ protocol, statusText ] = this.split(statusline, " ", 1);

    let line = (await stream.readline()).trimEnd();
    while (line) {
      let [name, value] = this.split(line, ":", 1);
      if (value) {
        name = name.trimStart();
        value = value.trim();
      }

      let nextLine = (await stream.readline()).trimEnd();

      while (this.startsWithSpace(nextLine)) {
        if (value) {
          value += nextLine;
        }

        nextLine = (await stream.readline()).trimEnd();
      }

      if (value) {
        try {
          headers.set(name, value);
        } catch(e) {}
      }
      line = nextLine;
    }

    statusText = statusText ? statusText.trim() : "";

    return new StatusAndHeaders({statusline, headers, protocol, statusText, totalRead: this.totalRead});
  }
}


// ===========================================================================
class WARCParser
{
  async parse(stream) {
    const headersParser = new StatusAndHeadersParser();

    const warcHeaders = await headersParser.parse(stream, {headersClass: Headers});
    const streamOffset = stream.getOffset();

    if (!warcHeaders) {
      return null;
    }

    const record = new WARCRecord({warcHeaders, stream});

    switch (record.warcType) {
      case "response":
        await this.addHttpHeaders(record, headersParser, stream, streamOffset);
        break;

      case "request":
        await this.addHttpHeaders(record, headersParser, stream, streamOffset);
        break;

      case "revisit":
        if (record.warcContentLength > 0) {
          await this.addHttpHeaders(record, headersParser, stream, streamOffset);
        }
        break;
    }

    return record;
  }

  async* iterRecords(stream) {
    let record = null;
    while (record = this.parse(stream)) {
      yield record;
    }
  }

  async addHttpHeaders(record, headersParser, stream, streamOffset) {
    const httpHeaders = await headersParser.parse(stream);
    record.addHttpHeaders(httpHeaders, stream.getOffset() - streamOffset);
  }
}


// ===========================================================================
class WARCRecord
{
  constructor({warcHeaders, stream}) {
    this.warcHeaders = warcHeaders;
    this.headersLen = 0;

    this.stream = new LimitReader(stream, this.warcContentLength);

    this.payload = null;
    this.httpHeaders = null;
    this.httpInfo = null;
  }

  addHttpHeaders(httpHeaders, headersLen) {
    this.httpHeaders = httpHeaders;
    this.headersLen = headersLen;

    this.stream.setLimitSkip(this.warcContentLength - this.headersLen);

    this.httpInfo = {headers: httpHeaders.headers,
                     statusCode: httpHeaders.statusCode(),
                     statusReason: httpHeaders.statusText};
  }

  async readFully() {
    if (this.payload) {
      return this.payload;
    }

    this.payload = await this.stream.readFully();
    await this.stream.stream.readSize(4);
    return this.payload;
  }

  warcHeader(name) {
    return this.warcHeaders.headers.get(name);
  }

  get warcType() {
    return this.warcHeaders.headers.get("WARC-Type");
  }

  get warcTargetURI() {
    return this.warcHeaders.headers.get("WARC-Target-URI");
  }

  get warcDate() {
    return this.warcHeaders.headers.get("WARC-Date");
  }

  get warcRefersToTargetURI() {
    return this.warcHeaders.headers.get("WARC-Refers-To-Target-URI");
  }

  get warcRefersToDate() {
    return this.warcHeaders.headers.get("WARC-Refers-To-Date");
  }

  get warcPayloadDigest() {
    return this.warcHeaders.headers.get("WARC-Payload-Digest");
  }

  get warcContentType() {
    return this.warcHeaders.headers.get("Content-Type");
  }

  get warcContentLength() {
    return Number(this.warcHeaders.headers.get("Content-Length"));
  }
}


export { StreamReader, StatusAndHeadersParser, WARCParser, concatChunks };

