"use strict";

import test from 'ava';

import pako from 'pako';

import { Headers } from 'node-fetch';

import { ReadableStream } from "web-streams-node";

import { StatusAndHeadersParser, StreamReader, WARCParser } from '../src/warcio';

global.Headers = Headers;


const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder("utf-8");


// ===========================================================================
// StreamReader utils
function getReader(items) {

  const rs = new ReadableStream({
    start(controller) {
      for (const item of items) {
        const buff = typeof(item) === "string" ? encoder.encode(item) : item;
        controller.enqueue(buff);
      }

      controller.close();
    }
  });

  return rs.getReader();
}

async function readLines(t, input, expected) {
  const stream = new StreamReader(getReader(input));

  let line;

  const output = [];

  for await (const line of await stream.iterLines()) {
    output.push(line);
  }

  t.deepEqual(output, expected);
}

// ===========================================================================
// Compression utils
function compressMembers(chunks) {
  const buffers = [];

  for (const chunk of chunks) {
    buffers.push(pako.gzip(encoder.encode(chunk)));
  }

  return Buffer.concat(buffers);
}


async function readDecomp(t, chunks, expectedOffsets, splitSize = 0, inc = 1) {
  if (splitSize === 0) {
    await _readDecomp(t, chunks, expectedOffsets, splitSize);
  } else {
    for (let i = 1; i <= splitSize; i += inc) {
      await _readDecomp(t, chunks, expectedOffsets, i);
    }
  }
}

async function _readDecomp(t, chunks, expectedOffsets, splitSize) {
  const input = compressMembers(chunks);

  const splits = [];

  if (splitSize === 0) {
    splits.push(input);
  } else {
    let count = 0;
    while (count < input.length) {
      splits.push(input.slice(count, count + splitSize));
      count += splitSize;
    }
  }

  const stream = new StreamReader(getReader(splits));

  //const stream = new StreamReader(decomp);

  //let chunk = await stream.read();

  const buff = [];

  const offsets = [];

  for await (const chunk of stream.iterChunks()) {
    offsets.push(stream.getOffset());
    buff.push(decoder.decode(chunk));
    //chunk = await stream.read();
  }

  //t.is(buff, chunks.join(""));
  t.deepEqual(buff, chunks);

  t.deepEqual(offsets, expectedOffsets);

  // try parsing each chunk individually
  if (chunks.length > 1) {
    const first = offsets[1];
    const newOffsets = offsets.slice(1).map((offset) => offset - first);
    await readDecomp(t, chunks.slice(1), newOffsets, splitSize);
  }
}

async function readDecompLines(t, chunks, expected) {
  const input = compressMembers(chunks);

  const stream = new StreamReader(getReader([input]));

  //const stream = new StreamReader(decomp);

  const lines = [];

  for await (const line of await stream.iterLines()) {
    lines.push(line);
  }

  t.deepEqual(lines, expected);
}


async function readChunkSizes(t, chunks, sizes, expected) {
  const inputs = [[compressMembers(chunks)], chunks];

  for (const input of inputs) {
    const stream = new StreamReader(getReader(input));

    const readChunks = [];

    for (const size of sizes) {
      let chunk = null;
      if (size === "line") {
        chunk = await stream.readline();
      } else {
        chunk = decoder.decode(await stream.readSize(size));
      }
      readChunks.push(chunk);
    }

    t.deepEqual(readChunks, expected);
  }
}




// ===========================================================================
// StatusAndHeaders parsing utils
async function readSH(t, input, expected) {
  const parser = new StatusAndHeadersParser();
  const result = await parser.parse(new StreamReader(getReader([input])));

  t.deepEqual(result.toString(), expected);
}


// ===========================================================================
// ===========================================================================
// Tests
test('readline() test 1', readLines,
  [
    "ABC\nDEFBLAHBLAH\nFOO",
    "BAR\n\n"
  ],
  [
    "ABC\n",
    "DEFBLAHBLAH\n",
    "FOOBAR\n",
    "\n"
  ]
);


test('readline() test 2', readLines,
  [
    `ABC\r
TEST
BART\r\
ABC`,
    "FOO"
  ],
  [
    "ABC\r\n",
    "TEST\n",
    "BART\rABCFOO",
  ]
);


test('decompressed reader single member', readDecomp,
  [
    'Some Data\nto read',
  ], [0]
);




test('decompressed reader multi member', readDecomp,
  [
    'Some Data',
    'Some\n More Data',
    'Another Chunk of Data',
    'extra data'
  ], [0, 29, 64, 105]
);


test('decompressed reader single member (1 to 10 byte chunks)', readDecomp,
  [
    'Some Data\nto read',
  ], [0], 10
);


test('decompressed reader multi member (1 to 15 byte chunks)', readDecomp,
  [
    'Some Data',
    'Some\n More Data',
    'Another Chunk of Data',
    'extra data'
  ], [0, 29, 64, 105], 15, 5
);


test('readline decompressed', readDecompLines,
  [
    'Some Data\nMore Data\nAnother Line',
    'New Chunk\nSame Chunk\n',
    'Single Line\n',
    'Next'
  ],
  [
    'Some Data\n',
    'More Data\n',
    'Another LineNew Chunk\n',
    'Same Chunk\n',
    'Single Line\n',
    'Next'
  ]
);

test('readsizes compressed and not compressed', readChunkSizes,
  [
    'Some Data',
    'Some\n More Data\n',
    '\nAnother Chunk of Data\n',
    'extra data'
  ],
  [4, 11, 9, 1, "line", "line", -1],
  ['Some',
   ' DataSome\n ',
   'More Data',
   '\n',
   '\n',
   'Another Chunk of Data\n',
   'extra data'
  ]
);


// ===========================================================================
test('StatusAndHeaders test 1', readSH,
  `\
HTTP/1.0 200 OK\r\n\
Content-Type: ABC\r\n\
HTTP/1.0 200 OK\r\n\
Some: Value\r\n\
Multi-Line: Value1\r\n\
    Also This\r\n\
\r\n\
Body`,

  `\
HTTP/1.0 200 OK\r
Content-Type: ABC\r
Some: Value\r
Multi-Line: Value1    Also This\r
`);

test('StatusAndHeaders test 2', readSH,
  `\
HTTP/1.0 204 Empty\r\n\
Content-Type: Value\r\n\
%Invalid%\r\n\
\tMultiline\r\n\
Content-Length: 0\r\n\
\r\n`,

  `HTTP/1.0 204 Empty\r
Content-Type: Value\r
Content-Length: 0\r
`);


test('Load WARC Records', async t => {
  const input = `\
WARC/1.0\r\n\
WARC-Type: warcinfo\r\n\
WARC-Record-ID: <urn:uuid:12345678-feb0-11e6-8f83-68a86d1772ce>\r\n\
WARC-Filename: testfile.warc.gz\r\n\
WARC-Date: 2000-01-01T00:00:00Z\r\n\
Content-Type: application/warc-fields\r\n\
Content-Length: 86\r\n\
\r\n\
software: recorder test\r\n\
format: WARC File Format 1.0\r\n\
json-metadata: {"foo": "bar"}\r\n\
\r\n\
\r\n\
WARC/1.0\r\n\
WARC-Type: response\r\n\
WARC-Record-ID: <urn:uuid:12345678-feb0-11e6-8f83-68a86d1772ce>\r\n\
WARC-Target-URI: http://example.com/\r\n\
WARC-Date: 2000-01-01T00:00:00Z\r\n\
WARC-Payload-Digest: sha1:B6QJ6BNJ3R4B23XXMRKZKHLPGJY2VE4O\r\n\
WARC-Block-Digest: sha1:OS3OKGCWQIJOAOC3PKXQOQFD52NECQ74\r\n\
Content-Type: application/http; msgtype=response\r\n\
Content-Length: 97\r\n\
\r\n\
HTTP/1.0 200 OK\r\n\
Content-Type: text/plain; charset="UTF-8"\r\n\
Custom-Header: somevalue\r\n\
\r\n\
some\n\
text\r\n\
\r\n\
WARC/1.0\r\n\
WARC-Type: response\r\n\
WARC-Record-ID: <urn:uuid:12345678-feb0-11e6-8f83-68a86d1772ce>\r\n\
WARC-Target-URI: http://example.com/\r\n\
WARC-Date: 2000-01-01T00:00:00Z\r\n\
WARC-Payload-Digest: sha1:B6QJ6BNJ3R4B23XXMRKZKHLPGJY2VE4O\r\n\
WARC-Block-Digest: sha1:KMUABC6URWIQ7QXCZDQ5FS6WIBBFRORR\r\n\
Content-Type: application/http; msgtype=response\r\n\
Content-Length: 268\r\n\
\r\n\
HTTP/1.0 200 OK\r\n\
Content-Type: text/plain; charset="UTF-8"\r\n\
Content-Disposition: attachment; filename*=UTF-8\'\'%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5.txt\r\n\
Custom-Header: somevalue\r\n\
Unicode-Header: %F0%9F%93%81%20text%20%F0%9F%97%84%EF%B8%8F\r\n\
\r\n\
more\n\
text\r\n\
\r\n\
`

  const parser = new WARCParser();

  const stream = new StreamReader(getReader([input]));

  const record0 = await parser.parse(stream);

  t.is(record0.warcType, "warcinfo");

  const warcinfo = decoder.decode(await record0.readFully());

  t.is(warcinfo, `\
software: recorder test\r\n\
format: WARC File Format 1.0\r\n\
json-metadata: {"foo": "bar"}\r\n\
`);

  const record = await parser.parse(stream);

  t.is(record.warcTargetURI, "http://example.com/");

  t.is(decoder.decode(await record.readFully()), "some\ntext");

  const record2 = await parser.parse(stream);

  t.is(decoder.decode(await record2.readFully()), "more\ntext");

  t.is(await parser.parse(stream), null);


});
