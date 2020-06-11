# wabac.js

*service worker based web archive replay*
  
**wabac.js** provides a full web archive replay system, or 'wayback machine', using
[Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)

**wabac.js** is a core component of <img src="/assets/logo.svg" width="24" height="24"> [ReplayWeb.page](https://replayweb.page).

The rest of the ReplayWeb.page is located at [webrecorder/replayweb.page](https://github.com/webrecorder/replayweb.page)

This library provides a 'server' component for web archive replay, and an API for managing web archive collections,
to be run within a service worker environment.

Besides ReplayWeb.page, the wabac.js service worker system also be used directly or with custom UI.

It includes a 'server' rewriting system, and can also be run in Node. This rewriting system complements the [wombat.js](https://github.com/webrecorder/wombat)
client-side rewriting system which runs in the client.

*Note: [wabac.js 1.0](https://github.com/webrecorder/wabac.js-1.0) also included a built-in UI component. This version is still available at [https://wab.ac/](https://wab.ac/)*


## API Documentation

The API provides all functionality for loading web archives and getting information about a web archive collections.

*Documentation coming soon!*

## Contributing

Contributions are welcome! As wabac.js is evolving quickly, please open an issue before submitting a pull request.

## LICENSE

**wabac.js** is licensed under the AGPLv3 license. If you are interested in using it under a different license, please inquire.
