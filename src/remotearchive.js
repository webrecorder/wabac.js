let EXTRACT_TS = /(?:([\d]+)[^\/]*\/)?(http.*)/;


class RemoteArchiveCache {
	
	constructor(remoteInfo) {
		this.replayPrefix = remoteInfo.replayPrefix;
		this.idMod = (remoteInfo.idMod !== undefined ? remoteInfo.idMod : "id_");
		this.redirMod = (remoteInfo.redirMod !== undefined ? remoteInfo.redirMod : "mp_");

		this.redirectMode = (this.idMod === this.redirMod) ? "follow" : "manual";

		this.urlMap = {}
		this.pageList = [];
	}

	getUrl(request, mod) {
		let url = this.replayPrefix;
		if (mod || request.timestamp) {
			url += request.timestamp + mod + "/";
		}
		return url + request.url;
	}

	async match(request, prefix) {
		let response = await fetch(this.getUrl(request, this.idMod),
			{credentials: 'same-origin',
			 redirect: this.redirectMode,
			 mode: 'cors'
			});

		let redirUrl = await this.getRedirect(request, response, prefix);

		if (redirUrl) {
			response = Response.redirect(redirUrl, 307);
			response.noRW = true;
		}

		response.timestamp = this.getTS(new Date().toISOString());
		return response;
	}

	async getRedirect(request, response, prefix) {
		// handle redirects by following
		if (response.type === "opaqueredirect") {
			response = await fetch(this.getUrl(request, this.redirMod),
				{credentials: 'same-origin',
				 redirect: 'follow',
				 mode: 'cors'
				});
		} else if (!response.redirected) {
			return null;
		}

		let inx = response.url.indexOf(this.replayPrefix) + this.replayPrefix.length;

		const redirUrl = response.url.slice(inx).replace(EXTRACT_TS, `$1mp_/$2`);

		return prefix + redirUrl;
	}

	getTS(iso) {
		return iso.replace(/[-:T]/g, '').slice(0, 14);
	}
}

export { RemoteArchiveCache };
