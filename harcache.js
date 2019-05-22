function parseHAR(file) {
	var reader = new FileReader();

	reader.readAsText(file);

	return new Promise(function(resolve) {
		reader.onloadend = function() {
			cache = new HARCache(reader.result);
			resolve(cache);
		}
	});
}


class HARCache {
	constructor(string) {
		let har = JSON.parse(string);

		this.parseEntries(har);

		this.parsePages(har);
	}

	parsePages(har) {
		this.pageList = [];

		for (let page of har.log.pages) {
			this.pageList.push(page.title);
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
		const entry = this.urlMap[request.url];
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