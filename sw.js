var prefix = self.registration.scope;

var collections = {};

importScripts("/parse5.js", "/rewrite.js", "/harcache.js", "/collection.js");

self.addEventListener('install', function(event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
    event.waitUntil(self.clients.claim());
    console.log("Activate!");
});

self.addEventListener('fetch', function(event) {
	event.respondWith(getResponseFor(event.request));
});


self.addEventListener("message", function(event) {
	switch (event.data.msg_type) {
		case "addColl":
			const coll = event.data.collection;
			coll.__proto__ = Collection.prototype;
			coll.cache.__proto__ = HARCache.prototype;
			
			collections[coll.name] = coll;
			coll.setPrefix(prefix);
			event.source.postMessage({"msg_type": "collAdded",
									  "prefix": coll.prefix});

		case "listAll":
			let msgData = [];
			for (let coll of Object.values(collections)) {
				msgData.push({"name": coll.name,
							  "prefix": coll.prefix,
							  "pageList": coll.cache.pageList});
			}
			event.source.postMessage({"msg_type": "listAll", "colls": msgData});
			break;
	}
});


async function getResponseFor(request) {
	let response = null;

	if (request.url === prefix) {
		return caches.match(request).then(function(resp) {
			if (resp) {
				return resp;
			}

			return fetch(request);
		}).catch(function() { return fetch(request); });
	}

	for (let coll of Object.values(collections)) {
		response = await coll.handleRequest(request);
		if (response) {
			return response;
		}
	}

	if (!response) {
		console.log(request.url);
		return fetch(request);
	}
}


