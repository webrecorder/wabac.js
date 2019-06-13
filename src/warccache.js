class WARCCache {
	constructor() {
		this.urlMap = {}
		this.pageList = [];
	}

	getTS(iso) {
		return iso.replace(/[-:T]/g, '').slice(0, 14);
	}

	parseWarcInfo(record) {
		var dec = new TextDecoder("utf-8");
		const text = dec.decode(record.content);

		for (let line of text.split("\n")) {
			if (line.startsWith("json-metadata:")) {
				try {
					const json = JSON.parse(line.slice("json-metadata:".length));

					const pages = json.pages || [];

					for (let page of pages) {
						this.pageList.push(page);
					}

				} catch (e) { }
			}
		}
	}

	async index(record, cdx) {
		if (record.warcType === "warcinfo") {
			this.parseWarcInfo(record);
			return;
		}

		if (record.warcType !== "response" && record.warcType !== "resource") {
			return;
		}

		let url = record.warcTargetURI;
		let timestamp = this.getTS(record.warcDate);
		let initInfo = null;

		if (record.httpInfo) {
			let status;

			try {
				status = parseInt(record.httpInfo.statusCode);
			} catch (e) {
				status = 200;
			}

			const statusText = record.httpInfo.statusReason;

			const headers = new Headers(record.httpInfo.headers);

			initInfo = { status, statusText, headers };

            // if no pages found, start detection if hasn't started already
            if (this.detectPages === undefined) {
                this.detectPages = !!this.pageList;
            }

            if (this.detectPages) {
                if (this.isPage(url, status, headers)) {
                    this.pageList.push({"url": url,
                    					"timestamp": timestamp,
                    					"title": url
                    					});
                }
            }
		}

        // needed due to bug in node-warc in including trailing \r\n in record
		const content = record.content.slice(0, record.content.byteLength - 2);

		this.urlMap[url] = {timestamp, initInfo, content};
	}

    isPage(url, status, headers) {
        if (status != 200) {
            return false;
        }

        if (!url.startsWith("http:") && !url.startsWith("https:")) {
            return false;
        }

        if (url.endsWith("/robots.txt")) {
            return false;
        }

        // skip urls with long query
        const parts = url.split("?", 2);

        if (parts.length === 2 && parts[1].length > parts[0].length) {
            return false;
        }

        // skip 'files' starting with '.' from being listed as pages
        if (parts[0].substring(parts[0].lastIndexOf("/") + 1).startsWith(".")) {
            return false;
        }

        let contentType = headers.get("Content-Type") || "";
		contentType = contentType.split(";", 1)[0];
        if (contentType !== "text/html" && contentType !== "text/plain") {
            return false;
        }

        return true;
    }

	match(request) {
		const entry = this.urlMap[request.url];
		if (!entry) {
			console.log(request.url);
			return null;
		}

		const resp = new Response(entry.content, entry.initInfo);
		resp.timestamp = entry.timestamp;
		return resp;
	}
}

export { WARCCache };
