"use strict";

import { Collection } from './collection.js';
import { HARCache } from './harcache.js';

self.prefix = self.registration.scope;

self.collections = {};

//importScripts("/parse5.js", "/rewrite.js", "/harcache.js", "/collection.js");

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
			
			self.collections[coll.name] = coll;
			coll.setPrefix(self.prefix);
			event.source.postMessage({"msg_type": "collAdded",
									  "prefix": coll.prefix});

		case "listAll":
			let msgData = [];
			for (let coll of Object.values(self.collections)) {
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

	if (request.url === self.prefix) {
		return caches.match(request).then(function(resp) {
			if (resp) {
				return resp;
			}

			return fetch(request);
		}).catch(function() { return fetch(request); });
	}

	for (let coll of Object.values(self.collections)) {
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


