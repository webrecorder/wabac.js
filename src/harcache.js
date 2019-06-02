"use strict";

function parseHAR(fileUrl) {
	return fetch(fileUrl).then(function(resp) {
		return resp.json();
	}).then(function(har) {
		return new HARCache(har);
	});
}


class HARCache {
	constructor(string_or_har) {
		let har = string_or_har;

		if (typeof har === "string") {
			har = JSON.parse(har);
		}

		this.parseEntries(har);

		this.parsePages(har);
	}

	parsePages(har) {
		this.pageList = [];

		for (let page of har.log.pages) {
			if (!page.pageTimings || !page.pageTimings.onLoad) {
				continue;
			}
			this.pageList.push({"ts": this.getTS(page.startedDateTime), "url": page.title});
		}
	}

	parseEntries(har) {
		this.urlMap = {}

		for (let entry of har.log.entries) {
			if (!entry.response.content || !entry.response.content.text) {
				continue;
			}
			this.urlMap[entry.request.url] = {
											  "request": entry.request,
											  "response": entry.response,
											  "timestamp": this.getTS(entry.startedDateTime),
											 };
		}
	}

	getTS(iso) {
		return iso.replace(/[-:T]/g, '').slice(0, 14);
	}

	match(request) {
		let url = request.url;

		let hash = url.indexOf("#");
		if (hash > 0) {
			url = url.substring(0, hash);
		}

		const entry = this.urlMap[url];
		if (!entry) {
			return null;
		}

		const headers = {}

		for (let header of entry.response.headers) {
			if (header.name.toLowerCase() === "content-encoding") {
				continue;
			}
			headers[header.name] = header.value;
		}

		const init = {"status": entry.response.status,
					  "statusText": entry.response.statusText,
					  "headers": headers
					 }

		let content = null;


		try {
			//content = atob(entry.response.content.text);
			content = Uint8Array.from(atob(entry.response.content.text), c => c.charCodeAt(0));
		} catch(e) {
			content = entry.response.content.text;
		}

		const resp = new Response(content, init);
		resp.timestamp = entry.timestamp;
		return resp;
	}
}

export { HARCache, parseHAR };

