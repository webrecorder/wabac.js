"use strict";

import { Collection } from './collection.js';
import { HARCache } from './harcache.js';
import { RemoteArchiveCache } from './remotearchive.js'
import { WARCCache } from './warccache.js';
import { WarcParser } from './warcparse.js';
import { WebBundleCache } from './webbundle.js';
import { notFound } from './utils.js';

function initReplayPrefix() {
  const sp = new URLSearchParams(self.location.search);

  const replayPrefix = sp.get("replayPrefix");

  let prefix = self.prefix;

  if (replayPrefix) {
    prefix += replayPrefix + "/";
  }

  return prefix;
}

self.prefix = self.registration ? self.registration.scope : '';

self.replayPrefix = initReplayPrefix();

self.staticPrefix = self.prefix + "static";

self.collections = {};

self.timeRanges = {};


importScripts("static/brotliDecode.js");

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
  console.log("Activate!");
});

self.addEventListener('fetch', function (event) {
  event.respondWith(getResponseFor(event.request, event));
});


async function initCollection(data) {
  let cache = null;
  let sourceName = null;

  if (data.files) {
    // TODO: multiple files
    let file = data.files[0];

    if (file.url) {
      const resp = await fetch(file.url);

      if (file.name.endsWith(".har")) {
        const har = await resp.json();
        cache = new HARCache(har);

      } else if (file.name.endsWith(".warc") || file.name.endsWith(".warc.gz")) {
        const ab = await resp.arrayBuffer();
        cache = new WARCCache();

        const parser = new WarcParser();
        await parser.parse(ab, cache.index.bind(cache));
      } else if (file.name.endsWith(".wbn")) {
        const ab = await resp.arrayBuffer();
        cache = new WebBundleCache(ab);
      }
      sourceName = "file://" + file.name;
    }
  } else if (data.remote) {
    cache = new RemoteArchiveCache(data.remote);
    sourceName = data.remote.replayPrefix;
  }

  if (!cache) {
    console.log("No Valid Cache!");
    return null;
  }

  const rootColl = data.root;
  const name = data.name;
  const staticPrefix = self.staticPrefix;
  const prefix = self.replayPrefix;

  return new Collection({name, cache, prefix, rootColl, sourceName, staticPrefix});
}

function doListAll(source) {
  let msgData = [];
  for (let coll of Object.values(self.collections)) {
    msgData.push({
      "name": coll.name,
      "prefix": coll.appPrefix,
      "pageList": coll.cache.pageList,
      "sourceName": coll.sourceName
    });
  }
  source.postMessage({ "msg_type": "listAll", "colls": msgData });
}

self.addEventListener("message", async function (event) {
  switch (event.data.msg_type) {
    case "addColl":
      const name = event.data.name;

      let coll = self.collections[name];

      if (!coll || !event.data.skipExisting) {
        coll = await initCollection(event.data);

        if (!coll) {
          return;
        }

        self.collections[name] = coll;
      }

      event.source.postMessage({
        "msg_type": "collAdded",
        "prefix": coll.prefix,
        "name": name
      });

      doListAll(event.source);
      break;

    case "removeColl":
      if (self.collections[event.data.name]) {
        delete self.collections[event.data.name];
        doListAll(event.source);
      }
      break;

    case "listAll":
      doListAll(event.source);
      break;
  }
});

async function defaultFetch(request) {
  let opts = {};
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    opts.cache = 'default';
  }
  return await fetch(request, opts);
}

async function getResponseFor(request, fe) {
  // if not within replay prefix, just pass through
  if (!request.url.startsWith(self.replayPrefix)) {
    return await defaultFetch(request);
  }

  let response = null;

  if (request.url.startsWith(self.replayPrefix + "stats.json")) {
    return await getStats(fe);
  }

  for (let coll of Object.values(self.collections)) {
    response = await coll.handleRequest(request);
    if (response) {
      updateStats(response, request, fe.clientId || fe.resultingClientId);
      return response;
    }
  }

  try {
    response = await caches.match(request);
    if (response) {
      return response;
    }
  } catch (e) {
    response = null;
  }

  try {
    response = await defaultFetch(request);
    if (response && response.status < 400) {
      return response;
    }
  } catch (e) {
    response = null;
  }

  return notFound(request);
}

function updateStats(response, request, id) {
  if (!id) {
    return;
  }

  if (!request.url || request.url.indexOf("mp_/") < 0) {
    return;
  }

  if (request.destination === "document" && (response.status > 300 && response.status < 400)) {
    return;
  }

  let timeRange = null;

  if (self.timeRanges[id] === undefined) {
    timeRange = { "count": 0, "children": [] };
    self.timeRanges[id] = timeRange;
    if (request.referrer.indexOf("mp_/") > 0) {
      self.clients.matchAll({ "type": "window" }).then(clients => updateStatsParent(id, request.referrer, clients));
    }
  } else {
    timeRange = self.timeRanges[id];
  }

  if (response.timestamp) {
    if (!timeRange.min || (response.timestamp < timeRange.min)) {
      timeRange.min = response.timestamp;
    }

    if (!timeRange.max || (response.timestamp > timeRange.max)) {
      timeRange.max = response.timestamp;
    }

    timeRange.count++;
  }
}

function updateStatsParent(id, referrer, clients) {
  for (let client of clients) {
    if (client.url === referrer) {
      //self.timeRanges[id].parent = client.id;
      if (!self.timeRanges[client.id]) {
        self.timeRanges[client.id] = { "count": 0, "children": { id: 1 } };
      } else {
        self.timeRanges[client.id].children[id] = 1;
      }
      break;
    }
  }
}

async function getStats(fe) {
  //const client = await self.clients.get(fe.clientId);

  //const timeRange = self.timeRanges[client.url] || {};

  const reqUrl = new URL(fe.request.url);

  const params = new URLSearchParams(reqUrl.search);

  let id = 0;

  const url = params.get("url");

  const clients = await self.clients.matchAll({ "type": "window" });

  const validIds = {};

  for (let client of clients) {
    if (client.url === url) {
      id = client.id;
    }
    validIds[client.id] = 1;
  }

  const srcRange = self.timeRanges[id] || {};

  const timeRange = {
    "count": srcRange.count || 0,
    "min": srcRange.min,
    "max": srcRange.max
  };

  const children = (self.timeRanges[id] && Object.keys(self.timeRanges[id].children)) || [];

  for (let child of children) {
    const childRange = self.timeRanges[child];

    if (!childRange) {
      continue;
    }


    if (!timeRange.min || (childRange.min < timeRange.min)) {
      timeRange.min = childRange.min;
    }

    if (!timeRange.max || (childRange.max > timeRange.max)) {
      timeRange.max = childRange.max;
    }

    timeRange.count += childRange.count;
  }

  // remove invalid timeranges
  for (let id of Object.keys(self.timeRanges)) {
    if (!validIds[id]) {
      delete self.timeRanges[id];
    }
  }

  return new Response(JSON.stringify(timeRange), { "headers": { "Content-Type": "application/json" } });
}


