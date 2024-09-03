## Live Proxy Example

This example demonstrates the minimal use of `wabac.js` set up as a live rewriting proxy using a CORS proxy, and supporting
custom script injection.

The example consists of an `index.html` which loads wabac.js in a frame and `index.js`, which includes the setup
for initializing a single collection that loads data through a CORS proxy. The service worker is assumed to be located in the root of this directory
as well.

### Usage

1. Copy the latest build of `sw.js` to this directory, eg. `cp dist/sw.js examples/live-proxy/sw.js`.

2. Start an http server, eg. `http-server -p 10001`

3. Load `http://localhost:10001/`. The page should proxy `https://example.com/` by default.

4. Specify a different URL to proxy by specifying the URL in the hashtag, eg: `http://localhost:10001/#https://iana.org/`

### CORS Proxy

All loading is done through a CORS proxy, which is presumed to be an instance of [wabac-cors-proxy](https://github.com/webrecorder/wabac-cors-proxy)

The `proxyPrefix` in index.js should be configured to the proper endpoint for this proxy. We recommend deploying your own version of this proxy for production use. (The default endpoint is accessible for testing from `http://localhost:10001` and certain Webrecorder domains)

### Custom Script Injection

The example also demonstrates injecting a custom script into each replay page, by loading `sw.js?injectScripts=custom.js`.

The custom script is not rewritten and can be used to add additional functionality to the proxy.
