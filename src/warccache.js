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
		}

		const content = record.content.slice(0, record.content.byteLength - 2);

		this.urlMap[url] = {timestamp, initInfo, content};
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