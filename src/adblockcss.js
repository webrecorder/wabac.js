import { AsyncIterReader } from "warcio";

export async function getAdBlockCSSResponse(fullDomain, adblockUrl) {
  const domainParts = fullDomain.split(".");
  const allDomains = [];

  for (let i = 0; i < domainParts.length - 1; i++) {
    if (domainParts[i] !== "www") {
      allDomains.push(domainParts.slice(i).join("."));
    }
  }
  const domain = allDomains.length ? allDomains[allDomains.length - 1] : "";

  const resp = await fetch(adblockUrl);

  let body = resp.body;

  if (adblockUrl.endsWith(".gz")) {
    body = body.pipeThrough(new self.DecompressionStream("gzip"));
  }

  const linestream = body.pipeThrough(new ByLineStream());

  async function* yieldRules(linestream) {
    try {
      for await (const line of AsyncIterReader.fromReadable(linestream.getReader())) {
        if (domain && line.indexOf(domain) >= 0) {
          const parts = line.split("##");
          if (parts.length < 2) {
            continue;
          }
          // exception rule
          if (parts[0].endsWith("#@")) {
            continue;
          }
          const matches = parts[0].split(",");

          // match all subdomains exactly
          for (const subdomain of allDomains) {
            if (matches.includes(subdomain)) {
              yield parts[1];
              break;
            }
          }

        } else if (!domain && line.startsWith("##")) {
          yield line.slice(2);
        }
      }
    } catch (e) {
      console.warn(e);
    }
  }

  const encoder = new TextEncoder();

  async function* yieldSelectors() {
    for await (const rule of yieldRules(linestream)) {
      yield encoder.encode(`${rule} {
  display: none !important;
}

`);
    }
  }

  const streamIter = yieldSelectors();

  const rs = new ReadableStream({
    pull(controller) {
      return streamIter.next().then((result) => {
        // all done;
        if (result.done || !result.value) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      });
    },
  });

  const status = 200;
  const statusText = "OK";
  const headers = new Headers({"Content-Type": "text/css"});
  return new Response(rs, {status, statusText, headers});
}


// Line TransformStream
// from: https://github.com/jimmywarting/web-byline
/*
MIT License

Copyright (c) 2016 Jimmy Karl Roland Wärting

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
export class ByLineTransform {
  constructor() {
    this._buffer = [];
    this._lastChunkEndedWithCR = false;
    this.decoder = new TextDecoder();
  }

  transform(chunkArray, controller) {
    const chunk = this.decoder.decode(chunkArray);
    // see: http://www.unicode.org/reports/tr18/#Line_Boundaries
    const lines = chunk.split(/\r\n|[\n\v\f\r\x85\u2028\u2029]/g);
    const buffer = this._buffer;

    // don't split CRLF which spans chunks
    if (this._lastChunkEndedWithCR && chunk[0] == "\n") {
      lines.shift();
    }

    if (buffer.length > 0) {
      buffer[buffer.length - 1] += lines[0];
      lines.shift();
    }

    this._lastChunkEndedWithCR = chunk[chunk.length - 1] == "\r";
    //buffer.push(...lines);

    // always buffer the last (possibly partial) line
    while (buffer.length > 1) {
      const line = buffer.shift();
      // skip empty lines
      if (line.length) controller.enqueue(line);
    }

    while (lines.length > 1) {
      const line = lines.shift();
      // skip empty lines
      if (line.length) controller.enqueue(line);
    }
  }

  flush(controller) {
    const buffer = this._buffer;

    while (buffer.length) {
      const line = buffer.shift();
      // skip empty lines
      if (line.length) controller.enqueue(line);
    }
  }
}

export class ByLineStream extends TransformStream {
  constructor() {
    super(new ByLineTransform);
  }
}
