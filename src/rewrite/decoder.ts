import brotliDecode from "brotli/decompress.js";

import pako from "pako";

import { AsyncIterReader } from "warcio";
import { type ArchiveResponse } from "../response";

// ===========================================================================
async function decodeResponse(
  response: ArchiveResponse,
  contentEncoding: string | null,
  transferEncoding: string | null,
  noRW: boolean,
) {
  // use the streaming decoder if gzip only and no rewriting
  if (
    response.reader &&
    noRW &&
    ((contentEncoding === "gzip" && !transferEncoding) ||
      (!contentEncoding && transferEncoding === "gzip"))
  ) {
    response.setReader(new AsyncIterReader(response.reader));
    return response;
  }

  const buffer = (await response.getBuffer()) || [];

  const origContent = new Uint8Array(buffer);

  const content = await decodeContent(
    origContent,
    contentEncoding,
    transferEncoding,
  );

  if (origContent !== content) {
    response.setBuffer(content);
  }

  return response;
}

// ===========================================================================
async function decodeContent(
  content: Uint8Array,
  contentEncoding: string | null,
  transferEncoding: string | null,
) {
  const origContent = content;

  try {
    if (transferEncoding === "chunked") {
      content = dechunkArrayBuffer(content);
    }
  } catch (e) {
    console.log("Chunk-Encoding Ignored: " + e);
  }

  try {
    if (contentEncoding === "br") {
      content = brotliDecode(content as Buffer);

      // if ended up with zero-length, probably not valid, just use original
      if (content.length === 0) {
        content = origContent;
      }
    } else if (contentEncoding === "gzip" || transferEncoding === "gzip") {
      const inflator = new pako.Inflate();

      inflator.push(content, true);

      // if error occurs (eg. not gzip), use original arraybuffer
      if (inflator.result && !inflator.err) {
        content = inflator.result as Uint8Array;
      }
    }
  } catch (e) {
    console.log("Content-Encoding Ignored: " + e);
  }

  return content;
}

// ===========================================================================
function dechunkArrayBuffer(data: Uint8Array) {
  let readOffset = 0;
  let writeOffset = 0;

  const decoder = new TextDecoder("utf-8");

  while (readOffset < data.length) {
    let i = readOffset;

    // check hex digits, 0-9, A-Z, a-z
    while (
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'. | TS2532 - Object is possibly 'undefined'.
      (data[i] >= 48 && data[i] <= 57) ||
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'. | TS2532 - Object is possibly 'undefined'.
      (data[i] >= 65 && data[i] <= 70) ||
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'. | TS2532 - Object is possibly 'undefined'.
      (data[i] >= 97 && data[i] <= 102)
    ) {
      i++;
    }

    // doesn't start with number, return original
    if (i === 0) {
      return data;
    }

    // ensure \r\n\r\n
    if (data[i] != 13 || data[i + 1] != 10) {
      return data;
    }

    i += 2;

    const chunkLength = parseInt(
      decoder.decode(data.subarray(readOffset, i)),
      16,
    );

    if (chunkLength == 0) {
      break;
    }

    data.set(data.subarray(i, i + chunkLength), writeOffset);

    i += chunkLength;

    writeOffset += chunkLength;

    if (data[i] == 13 && data[i + 1] == 10) {
      i += 2;
    }

    readOffset = i;
  }

  return data.subarray(0, writeOffset);
}

export { decodeResponse, decodeContent };
