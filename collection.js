class Collection
{
	constructor(name, cache) {
		this.name = name;
		this.cache = cache;

		this.prefix = null;

		this.staticPrefix = "/static";

		this.replayRX = /^([0-9]{0,14})(?:([A-Za-z]{2,3}_)\/)?(.*)/;
	}

	setPrefix(prefix) {
		this.prefix = prefix + this.name + "/";
	}

	async handleRequest(request) {
		if (!request.url.startsWith(this.prefix)) {
			return null;
		}

		const wbUrlStr = request.url.substring(this.prefix.length);

		let response_data = {"status": 200,
							 "statusText": "OK",
							 "headers": {"Content-Type": "text/html"}
							};

		let content = null;

		// pageList
		if (wbUrlStr == "") {

			content = '<html><body><h2>Available Pages</h2><ul>'

			for (let pageUrl of this.cache.pageList) {
				content += `<li><a href="${this.prefix}${pageUrl}">${pageUrl}</a></li>`
			}

			content += '</ul></body></html>'

			return new Response(content, response_data);
		}

		const wbUrl = this.replayRX.exec(wbUrlStr);

		if (!wbUrl) {
			return this.notFound();
		}

		const requestTS = wbUrl[1];
		const mod = wbUrl[2];
		const url = wbUrl[3];

		if (mod) {
			let content_response = this.cache.match({"url": url});

			if (content_response) {
				let headInsert = "";

				if (request.destination === "" || request.destination === "document") {
					headInsert = this.makeHeadInsert(url, content_response.timestamp, request.url, requestTS);
				}

				const rewriter = new Rewriter(url, this.prefix + "mp_/", headInsert);
				content_response = rewriter.rewrite(content_response, request.destination);
			}

			if (content_response) {
				return content_response;
			} else {
				return this.notFound();
			}

		} else {
			return this.makeTopFrame(url, requestTS);
		}
			
	}

	notFound() {
		let response_data = {"status": 404,
						   	 "statusText": "Not Found",
							 "headers": {"Content-Type": "text/html"}
							};

		return new Response('404 Not Found', response_data);
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

<script src='${this.staticPrefix}/default_banner.js'> </script>
<link rel='stylesheet' href='${this.staticPrefix}/default_banner.css'/>

</head>
<body style="margin: 0px; padding: 0px;">
<div id="wb_iframe_div">
<iframe id="replay_iframe" frameborder="0" seamless="seamless" scrolling="yes" class="wb_iframe"></iframe>
</div>
<script>
  var cframe = new ContentFrame({"url": "${url}" + window.location.hash,
                                 "prefix": "${this.prefix}",
                                 "request_ts": "${requestTS}",
                                 "iframe": "#replay_iframe"});

</script>
</body>
</html>
`
		let response_data = {"status": 200,
							 "statusText": "OK",
							 "headers": {"Content-Type": "text/html"}
							};

		return new Response(content, response_data);
	}

	makeHeadInsert(url, timestamp, requestUrl, requestTS) {

		const topUrl = requestUrl.replace("mp_/", "");
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