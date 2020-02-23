"use strict";

import { Readable, Transform } from 'stream';
import { Inflate } from 'pako';

import { WARCStreamTransform } from 'node-warc';

class WarcParser {
  constructor() {
    //this.reader = new FileReader();
    this.warc = new WARCStreamTransform();

    this.rstream = new Readable();
    this.rstream._read = () => { };

    //this.reader.addEventListener("progress", (event) => { this.onUpdate() });
    //this.reader.addEventListener("loadend", (event) => { this.onDone(); });

    this.lastOffset = 0;

    this.offsets = [];
    this.recordCount = 0;
  }

  parse(arraybuffer, cache) {
    // this.rstream.pipe(this.warc).on('data', (record) => {
    //  console.log(record.warcTargetURI);
    // });
    this.recordCount = 0;

    const buffer = new Uint8Array(arraybuffer);

    const isGzip = (buffer.length > 2 && buffer[0] == 0x1f && buffer[1] == 0x8b && buffer[2] == 0x08);

    if (isGzip) {
      return new Promise((resolve, reject) => {
        this.rstream.pipe(new DecompStream(this)).pipe(this.warc)
          .on('data', (record) => { cache.index(record, this.offsets[this.recordCount++]) })
          .on('end', () => { cache.indexDone(); resolve(); })
          .on('error', () => { cache.indexError(); resolve(); });

        this.rstream.push(buffer);
        this.rstream.push(null);
      });
    } else {
      return new Promise((resolve, reject) => {
        this.rstream.pipe(this.warc)
          .on('data', (record) => { cache.index(record, {}) })
          .on('end', () => { cache.indexDone(); resolve(); })
          .on('error', () => { cache.indexError(); resolve(); });

        this.rstream.push(buffer);
        this.rstream.push(null);
      });
    }
  }
}


class DecompStream extends Transform {
  constructor(parser) {
    super();
    this.parser = parser;
  }

  _transform(buffer, encoding, done) {
    let strm, len, pos = 0;

    let lastPos = 0;
    let inflator;

    do {
      len = buffer.length - pos;

      const _in = new Uint8Array(buffer.buffer, pos, len);

      inflator = new Inflate();

      strm = inflator.strm;
      inflator.push(_in, true);

      this.push(inflator.result);

      lastPos = pos;
      pos += strm.next_in;

      this.parser.offsets.push({ "offset": lastPos, "length": pos - lastPos });

    } while (strm.avail_in);

    done();
  }

  _flush(done) {
    done()
  }
}


export { WarcParser };
