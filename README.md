# WABAC.js 
### Web Archive Browsing Augmentation Client :watch: :rewind: :repeat: :rocket:

WABAC.js proof-of-concept web archive replay system implemented entirely via [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)

It allows browsing web archives in WARC or HAR files directly in a modern browser without requiring a server component.

## Usage

This repository itself is hosted as a static site at: https://wab.ac/ and provides all functionality.

To run locally, a simple http server, eg. `python -m http.server 9990` should suffice, however, some browsers may not support
service workers from localhost.

To use, select a WARC or HAR file to be loaded into WABAC. The files loaded will not be uploaded anywhere and will be parsed in the browser.

To create a WARC file, you can use https://webrecorder.io/ and download the resulting file.

WABAC.js also supports loading HAR files, [which can be created directly by any browser](https://toolbox.googleapps.com/apps/har_analyzer/).

You can load multiple files with a different collection name. The collections are available only to you.

## Dynamic Collections API

It's also possible to generate collections dynamically on the fly by linking to a WARC/HAR already hosted.

For example, the WARC [examples/netpreserve-twitter.warc](examples/netpreserve-twitter.warc) in this repository 
is available for download at *https://wab.ac/examples/netpreserve-twitter.warc*

The link:

**https://wab.ac/?coll_example=examples/netpreserve-twitter.warc**

can be used to automatically download the warc, index it, and add it as collection 'example'.
If it works, you should see 3 pages available for replay.

It's also possible to automatically redirect to a url for replay:

**https://wab.ac/?coll_example=examples/netpreserve-twitter.warc&url=example/https://twitter.com/netpreserve**

The above link should load the collection and then redirect to one of the pages. If all goes well,
you should be browsing an archive of IIPC's twitter page, entirely from github!

## How it Works

The system consists of two main components, a service worker 'server' implementation based roughly on portions
of [pywb](https://github.com/webrecorder/pywb) web archive replay system, and the page interface which controls the
index page rendering and updates from the service worker. (The client-side wombat.js library from pywb is also used).

The service worker server uses:
- [parse5](https://github.com/inikulin/parse5) for HTML parsing
- [pako](https://github.com/nodeca/pako) for gzip decompression
- Node `stream` library (as packaged by webpack)
- A [fork](https://github.com/ikreymer/node-warc) of https://github.com/N0taN3rd/node-warc for WARC parsing to run in browser.
- Everything packaged via webpack

A frame is used to wrap the replayed content and provide a banner. The banner provides a date range listing all resources
on the page [in an effort to provide increased replay transparency](https://blog.dshr.org/2019/06/michael-nelsons-cni-keynote-part-3.html)

The service worker is mounted at the root of the site and manages all collections. Local files are sent as blobs to the service worker
for parsing.

### Limitations

This repo is still an early prototype and should be used with caution.
It has the following limitations:
- The system must load an entire file for indexing, which limits the size of WARC/HAR files which can be handled.
- Loading existing indexes (eg. CDXJ) is not yet supported.
- Replay fidelity is incomplete and only exact matching is possible. Fuzzy matching not yet supported.
- Brotli decompression is not yet supported.
- Collection data is not persisted beyond the life of the service worker.

