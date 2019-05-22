var prefix = self.registration.scope;

var collections = [];

importScripts("/parse5.js", "/rewrite.js", "/harcache.js", "/collection.js");

self.addEventListener('fetch', function(event) {
	event.respondWith(getResponseFor(event.request));
});


self.addEventListener("message", function(event) {
	switch (event.data.msg_type) {
		case "addColl":
			const coll = event.data.collection;
			coll.__proto__ = Collection.prototype;
			coll.cache.__proto__ = HARCache.prototype;
			
			collections.push(coll);
			coll.setPrefix(prefix);
			event.source.postMessage({"msg_type": "collAdded", "prefix": coll.prefix});
	}
});


async function getResponseFor(request) {
	let response = null;

	for (let coll of collections) {
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


