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

async function initCollection(data) {
	// TODO: multiple files
	let file = data.files[0];

	let cache = null;

	if (file.name.endsWith(".har") && file.url) {
		const resp = await fetch(file.url);
		const har = await resp.json();
		cache = new HARCache(har);
	}

	if (!cache) {
		console.log("No Valid Cache!");
		//reject("No Valid Cache");
		return;
	}
	
	let coll = new Collection(data.name, cache);

	coll.setPrefix(self.prefix);

	return coll;
}

function doListAll(source)
{
	let msgData = [];
	for (let coll of Object.values(self.collections)) {
		msgData.push({"name": coll.name,
					  "prefix": coll.prefix,
					  "pageList": coll.cache.pageList});
	}
	source.postMessage({"msg_type": "listAll", "colls": msgData});
}

self.addEventListener("message", function(event) {
	switch (event.data.msg_type) {
		case "addColl":
			initCollection(event.data).then(function(coll) {
				self.collections[event.data.name] = coll;
				event.source.postMessage({"msg_type": "collAdded",
										  "prefix": coll.prefix});

				doListAll(event.source);
			});
			break;

		case "listAll":
			doListAll(event.source);
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


