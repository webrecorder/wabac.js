import { StreamReader } from './warcio';

const decoder = new TextDecoder("utf-8");

class ArchiveResponse
{

  static fromResponse({url, response, date, noRW, isLive}) {
    const payload = new StreamReader(response.body.getReader(), false);
    const status = response.status;
    const statusText = response.statusText;
    const headers = response.headers;

    return new ArchiveResponse({payload, status, statusText, headers, url, date, noRW, isLive});
  }

  constructor({payload, status, statusText, headers, url, date, extraOpts = null, noRW = false, isLive = false}) {
    this.stream = null;
    this.buffer = null;

    if (payload && payload.read) {
      this.stream = payload;
    } else {
      this.buffer = payload;
    }

    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.url = url;
    this.date = date;
    this.extraOpts = extraOpts;
    this.noRW = noRW;
    this.isLive = isLive;
  }

  async getText() {
    const buff = await this.getBuffer();
    return typeof(buff) === "string" ? buff : decoder.decode(buff);
  }

  async getBuffer() {
    if (this.buffer) {
      return this.buffer;
    }

    this.buffer = await this.stream.readFully();
    return this.buffer;
  }

  async setContent(content) {
    if (content.read) {
      this.stream = content;
      this.buffer = null;
    } else if (content.getReader) {
      this.stream = new StreamReader(content.getReader());
      this.buffer = null;
    } else {
      this.stream = null;
      this.buffer = content;
    }
  }

  async* iterChunks() {
    if (this.buffer) {
      yield this.buffer;
    } else if (this.stream) {
      yield* this.stream.iterChunks();
    }
  }

  setRange(range) {
    const bytes = range.match(/^bytes\=(\d+)\-(\d+)?$/);

    let length = 0;

    if (this.buffer) {
      length = this.buffer.length;
    } else if (this.stream) {
      //length = this.stream.length;
      length = Number(this.headers.get("content-length"));

      // if length is not known, keep as 200
      if (!length) {
        return;
      }
    }

    if (!bytes) {
      this.status = 416;
      this.statusText = 'Range Not Satisfiable';
      this.headers.set('Content-Range', `*/${length}`);
      return false;
    }

    const start = Number(bytes[1]);
    const end = Number(bytes[2]) || (length - 1);

    if (this.buffer) {
      this.buffer = this.buffer.slice(start, end + 1);

    } else if (this.stream) {
      if (start !== 0 || end !== (length - 1)) {
        this.stream.setLimitSkip(end - start + 1, start);
      }
    }

    this.headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
    this.headers.set('Content-Length', end - start + 1);

    this.status = 206;
    this.statusText = 'Partial Content';

    return true;
  }

  makeResponse() {
    const body = this.stream ? streamingReader(this.stream) : this.buffer;

    const response = new Response(body, {status: this.status,
                                         statusText: this.statusText,
                                         headers: this.headers});
    response.date = this.date;
    return response;
  }
}


// ===========================================================================
function streamingReader(stream) {
  let count = 0;

  return new ReadableStream({
    start(controller) {
    },

    pull(controller) {
      return stream.read().then((res) => {
        if (!res.value) {
          controller.close();
          return;
        }
        controller.enqueue(res.value);
      });
    },

    cancel() {
      console.warn("stream canceled!");
    }
  });
}


export { ArchiveResponse };

