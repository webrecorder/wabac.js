# wabac.js

*service worker based web archive replay*
  
**wabac.js** provides a full web archive replay system, or 'wayback machine', using
[Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)

**wabac.js** is a core part of <img src="https://replayweb.page/assets/logo.svg" width="24" height="24"> [ReplayWeb.page](https://replayweb.page).

This library provides the 'server-side' portion for web archive replay, and an API for managing web archive collections,
and is designed to be run as service worker (or web worker). The system handles URL rewriting and preparing web archive
pages to be replayed. This rewriting system complements the [wombat.js](https://github.com/webrecorder/wombat)
client-side rewriting system which runs on the client (injected into each page).

## ReplayWeb.page

The user-facing UI for ReplayWeb.page is located at [webrecorder/replayweb.page](https://github.com/webrecorder/replayweb.page)

## Usage Examples

Using the ReplayWeb.page is only one way to use wabac.js. Additional ways to use this library as a standalone will be added below:

- [Live Proxy](./examples/live-proxy) - an example of using wabac.js to render a live, rewritten proxy of other web pages, with custom scripts injected into each page. This can be used to provide an annotation viewer to live web pages.

## API Documentation

The API provides all functionality for loading web archives and getting information about a web archive collections.

*Documentation coming soon!*

## Old Version

[wabac.js 1.0](https://github.com/webrecorder/wabac.js-1.0) also included a built-in UI component. This version is still available at [https://wab.ac/](https://wab.ac/)*


## Contributing

Contributions are welcome! As wabac.js is evolving quickly, please open an issue before submitting a pull request.

## LICENSE

**wabac.js** is licensed under the AGPLv3 license. If you are interested in using it under a different license, please inquire.
