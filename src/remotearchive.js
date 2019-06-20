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

		const redirRes = await this.getRedirect(request, response, prefix);

		let timestamp = null;

		if (redirRes) {
			response = Response.redirect(redirRes[1], 307);
			response.noRW = true;
			timestamp = redirRes[0];
		} else {
			timestamp = request.timestamp;
		}

		response.timestamp = timestamp || this.getTS(new Date().toISOString());

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

		const inx = response.url.indexOf(this.replayPrefix) + this.replayPrefix.length;

		const redirOrig = response.url.slice(inx);

		const m = redirOrig.match(EXTRACT_TS);

		if (m) {
			return [m[1], prefix + m[1] + "mp_/" + m[2]];
		} else {
			return [null, prefix + redirOrig];
		}
	}

	getTS(iso) {
		return iso.replace(/[-:T]/g, '').slice(0, 14);
	}
}

export { RemoteArchiveCache };
