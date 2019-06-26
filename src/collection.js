"use strict";

import Rewriter from './rewrite.js';

import { parseHAR } from './harcache.js';

const DEFAULT_CSP = "default-src 'unsafe-eval' 'unsafe-inline' 'self' data: blob: mediastream: ws: wss: ; form-action 'self'";

const REPLAY_REGEX = /^(\d*)([a-z]+_|[$][a-z0-9:.-]+)?[\/|](.+)/;


class Collection
{
	constructor(name, cache, prefix, rootColl, sourceName) {
		this.name = name;
		this.cache = cache;

		this.sourceName = sourceName;

		this.rootPrefix = prefix;

		this.prefix = prefix + this.name + "/";

		// support root collection hashtag nav
		if (rootColl) {
			this.appPrefix = prefix + "#/";
			this.isRoot = true;
		} else {
			this.appPrefix = this.prefix;
			this.isRoot = false;
		}

		this.staticPrefix = prefix + "static";
	}

	async handleRequest(request) {
		let wbUrlStr = decodeURI(request.url);

		if (wbUrlStr.startsWith(this.prefix)) {
			wbUrlStr = wbUrlStr.substring(this.prefix.length);
		} else if (this.isRoot && wbUrlStr.startsWith(this.appPrefix)) {
			wbUrlStr = wbUrlStr.substring(this.appPrefix.length);
		} else {
			return null;
		}

		let responseData = {"status": 200,
							 "statusText": "OK",
						     "headers": {"Content-Type": "text/html"}
							};

		let content = null;

		// pageList
		if (wbUrlStr == "") {

			content = '<html><body><h2>Available Pages</h2><ul>'

			for (let page of this.cache.pageList) {
				let href = this.appPrefix;
				if (page.ts) {
					href += page.ts + "/";
				}
				href += page.url;
				content += `<li><a href="${href}">${page.url}</a></li>`
			}

			content += '</ul></body></html>'

			return new Response(content, responseData);
		}

		const wbUrl = REPLAY_REGEX.exec(wbUrlStr);
		let requestTS = '';
		let url = '';
		let mod = '';

		if (!wbUrl && (wbUrlStr.startsWith("https:") || wbUrlStr.startsWith("http:"))) {
			url = wbUrlStr;
		} else if (!wbUrl) {
			return this.notFound();
		} else {
			requestTS = wbUrl[1];
			mod = wbUrl[2];
			url = wbUrl[3];
		}

		// force timestamp for root coll
		if (!requestTS && this.isRoot) {
			requestTS = "2";
		}

		if (mod) {
			const hash = url.indexOf("#");
			if (hash > 0) {
				url = url.substring(0, hash);
			}

			let referrer = request.referrer;

			let response = null;

			const rwPrefix = this.prefix;// + requestTS + mod + "/";

			if (url.startsWith("//")) {
				response = await this.cache.match({"url": "https:" + url, "timestamp": requestTS}, rwPrefix);

				if (!response) {
					response = await this.cache.match({"url": "http:" + url, "timestamp": requestTS}, rwPrefix);
					if (response) {
						url = "http:" + url;
					}
				} else {
					url = "https:" + url;
				}
			} else {
				response = await this.cache.match({"url": url, "timestamp": requestTS}, rwPrefix);
			}

			if (response && !response.noRW && mod != "id_") {
				let headInsert = "";

				if (request.destination === "" || request.destination === "document") {
					headInsert = this.makeHeadInsert(url, response.timestamp, request.url, requestTS);
				}

				const rewriter = new Rewriter(url, this.prefix + requestTS + "mp_/", headInsert);
				response = await rewriter.rewrite(response, request.destination, DEFAULT_CSP);
			}

			if (response) {
				return response;
			} else {
				return this.notFound();
			}

		} else {
			return this.makeTopFrame(url, requestTS);
		}
			
	}

	notFound() {
		let responseData = {"status": 404,
						   	 "statusText": "Not Found",
							 "headers": {"Content-Type": "text/html"}
							};

		return new Response('404 Not Found', responseData);
	}

	makeTopFrame(url, requestTS) {
		const content = `
<!DOCTYPE html>
<html>
<head>
<style>
html, body
{
  height: 100%;
  margin: 0px;
  padding: 0px;
  border: 0px;
  overflow: hidden;
}

</style>
<script src='${this.staticPrefix}/wb_frame.js'> </script>

<script>
window.home = "${this.rootPrefix}";
</script>

<script src='${this.staticPrefix}/default_banner.js'> </script>
<link rel='stylesheet' href='${this.staticPrefix}/default_banner.css'/>

</head>
<body style="margin: 0px; padding: 0px;">
<div id="wb_iframe_div">
<iframe id="replay_iframe" frameborder="0" seamless="seamless" scrolling="yes" class="wb_iframe"></iframe>
</div>
<script>
  var cframe = new ContentFrame({"url": "${url}",
                                 "app_prefix": "${this.appPrefix}",
                                 "content_prefix": "${this.prefix}",
                                 "request_ts": "${requestTS}",
                                 "iframe": "#replay_iframe"});

</script>
</body>
</html>
`
		let responseData = {"status": 200,
							 "statusText": "OK",
							 "headers": {"Content-Type": "text/html", "Content-Security-Policy": DEFAULT_CSP}
							};

		return new Response(content, responseData);
	}

	makeHeadInsert(url, timestamp, requestUrl, requestTS) {

		const topUrl = this.appPrefix + requestTS + (requestTS ? "/" : "") + url;
		const prefix = this.prefix;
		const coll = this.name;

		const urlParsed = new URL(url);
		return `
<!-- WB Insert -->
<script>
  wbinfo = {};
  wbinfo.top_url = "${topUrl}";
  // Fast Top-Frame Redirect
  if (window == window.top && wbinfo.top_url) {
    var loc = window.location.href.replace(window.location.hash, "");
    loc = decodeURI(loc);
 
    if (loc != decodeURI(wbinfo.top_url)) {
        window.location.href = wbinfo.top_url + window.location.hash;
    }
  }
  wbinfo.url = "${url}";
  wbinfo.timestamp = "${timestamp}";
  wbinfo.request_ts = "${requestTS}";
  wbinfo.prefix = decodeURI("${prefix}");
  wbinfo.mod = "mp_";
  wbinfo.is_framed = true;
  wbinfo.is_live = false;
  wbinfo.coll = "${coll}";
  wbinfo.proxy_magic = "";
  wbinfo.static_prefix = "${this.staticPrefix}/";
  wbinfo.enable_auto_fetch = true;
</script>
<script src='${this.staticPrefix}/wombat.js'> </script>
<script>
  wbinfo.wombat_ts = "${timestamp}";
  wbinfo.wombat_sec = "";
  wbinfo.wombat_scheme = "${urlParsed.protocol.slice(0, -1)}";
  wbinfo.wombat_host = "${urlParsed.host}";

  wbinfo.wombat_opts = {};

  if (window && window._WBWombatInit) {
    window._WBWombatInit(wbinfo);
  }
</script>
  `
	}
}

export { Collection };

