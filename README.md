# wabac.js

_service worker based web archive replay_

**wabac.js** provides a full web archive replay system, or 'wayback machine', using
[Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)

**wabac.js** is a core part of <img src="https://raw.githubusercontent.com/webrecorder/replayweb.page/refs/heads/main/favicons/icon-192.png" width="24" height="24"> [ReplayWeb.page](https://replayweb.page).

With 2.20.0 release, wabac.js is written fully in TypeScript.

This library provides the 'server-side' portion for web archive replay, and an API for managing web archive collections,
and is designed to be run as service worker (or web worker). The system handles URL rewriting and preparing web archive
pages to be replayed. This rewriting system complements the [wombat.js](https://github.com/webrecorder/wombat)
client-side rewriting system which runs on the client (injected into each page).

## ReplayWeb.page

The user-facing UI for ReplayWeb.page is located at [webrecorder/replayweb.page](https://github.com/webrecorder/replayweb.page)

## Usage Examples

Using the ReplayWeb.page is only one way to use wabac.js. Additional ways to use this library as a standalone will be added below:

- [Live Proxy](./examples/live-proxy) - an example of using wabac.js to render a live, rewritten proxy of other web pages, with custom scripts injected into each page. This can be used to provide an annotation viewer to live web pages.

## API

When the wabac.js service worker is installed, it provides an API for serving archived web content, as well as metadata about web archive collections.
All archives are organized into discreet collections with a unique id.

- `/w/<collection id>/<modifier >/https://...` - provides an endpoint for loading archived web content by URL.

- `/w/api/c/<collection id>` - provides an endpoint for getting info about a web archive collection

Additional documentation on this API is still a work-in-progress.


## Usage as a module

wabac.js can also be used imported as a module, providing two exports:

`import * from @webrecorder/wabac` - Provides exports for rewriting and WACZ reading. Designed to be used as a general purpose library in any JS environment. See [index.ts](src/index.ts) for more details.

`import * from @webrecorder/wabac/swlib` - Provides exports for extending wabac.js functionality in a service worker. Designed to be used in a service worker or web worker environment. See [swlib.ts](src/swlib.ts) for more details. See [webrecorder/awp-sw](https://github.com/webrecorder/awp-sw) for an example of this usage.



## Old Version

[wabac.js 1.0](https://github.com/webrecorder/wabac.js-1.0) also included a built-in UI component. This version is still available at [https://wab.ac/](https://wab.ac/)

## Contributing

Contributions are welcome! As wabac.js is evolving quickly, please open an issue before submitting a pull request.

## LICENSE

**wabac.js** is licensed under the AGPLv3 license. If you are interested in using it under a different license, please inquire.
