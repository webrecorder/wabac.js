/*! wombatWorkers.js is part of Webrecorder project. Copyright (C) 2020=2021, Webrecorder Software. Licensed under the Affero General Public License v3. */
(function(e, a) { for(var i in a) e[i] = a[i]; }(self, /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/dist/";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./node_modules/@webrecorder/wombat/src/wombatWorkers.js");
/******/ })
/************************************************************************/
/******/ ({

/***/ "./node_modules/@webrecorder/wombat/src/wombatWorkers.js":
/*!***************************************************************!*\
  !*** ./node_modules/@webrecorder/wombat/src/wombatWorkers.js ***!
  \***************************************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony default export */ __webpack_exports__[\"default\"] = (\"/**\\n * Mini wombat for performing URL rewriting within the\\n * Web/Shared/Service Worker context\\n * @param {Object} info\\n * @return {WBWombat}\\n */\\nfunction WBWombat(info) {\\n  if (!(this instanceof WBWombat)) return new WBWombat(info);\\n  /** @type {Object} */\\n  this.info = info;\\n  this.initImportScriptsRewrite();\\n  this.initHTTPOverrides();\\n  this.initClientApisOverride();\\n  this.initCacheApisOverride();\\n}\\n\\n/**\\n * Returns T/F indicating if the supplied URL is not to be rewritten\\n * @param {string} url\\n * @return {boolean}\\n */\\nWBWombat.prototype.noRewrite = function(url) {\\n  return (\\n    !url ||\\n    url.indexOf('blob:') === 0 ||\\n    url.indexOf('javascript:') === 0 ||\\n    url.indexOf('data:') === 0 ||\\n    url.indexOf(this.info.prefix) === 0\\n  );\\n};\\n\\n/**\\n * Returns T/F indicating if the supplied URL is an relative URL\\n * @param {string} url\\n * @return {boolean}\\n */\\nWBWombat.prototype.isRelURL = function(url) {\\n  return url.indexOf('/') === 0 || url.indexOf('http:') !== 0;\\n};\\n\\n/**\\n * Attempts to resolve the supplied relative URL against\\n * the origin this worker was created on\\n * @param {string} maybeRelURL\\n * @param {string} against\\n * @return {string}\\n */\\nWBWombat.prototype.maybeResolveURL = function(maybeRelURL, against) {\\n  if (!against) return maybeRelURL;\\n  try {\\n    var resolved = new URL(maybeRelURL, against);\\n    return resolved.href;\\n  } catch (e) {}\\n  return maybeRelURL;\\n};\\n\\n/**\\n * Returns null to indicate that the supplied URL is not to be rewritten.\\n * Otherwise returns a URL that can be rewritten\\n * @param {*} url\\n * @param {string} resolveAgainst\\n * @return {?string}\\n */\\nWBWombat.prototype.ensureURL = function(url, resolveAgainst) {\\n  if (!url) return url;\\n  var newURL;\\n  switch (typeof url) {\\n    case 'string':\\n      newURL = url;\\n      break;\\n    case 'object':\\n      newURL = url.toString();\\n      break;\\n    default:\\n      return null;\\n  }\\n  if (this.noRewrite(newURL)) return null;\\n  if (this.isRelURL(newURL)) {\\n    return this.maybeResolveURL(newURL, resolveAgainst);\\n  }\\n\\n  // if url starts with current origin, but not properly rewritten, rewrite against current baseUr\\n  if (newURL.indexOf(self.location.origin) === 0) {\\n    return this.maybeResolveURL(newURL.slice(self.location.origin.length), resolveAgainst);\\n  }\\n  return newURL;\\n};\\n\\n/**\\n * Rewrites the supplied URL\\n * @param {string} url\\n * @return {string}\\n */\\nWBWombat.prototype.rewriteURL = function(url) {\\n  var rwURL = this.ensureURL(url, this.info.originalURL);\\n  if (!rwURL) return url;\\n  if (this.info.prefixMod) {\\n    return this.info.prefixMod + rwURL;\\n  }\\n  return rwURL;\\n};\\n\\n/**\\n * Rewrites the supplied URL of an controlled page using the mp\\\\_ modifier\\n * @param {string} url\\n * @param {WindowClient} [client]\\n * @return {string}\\n */\\nWBWombat.prototype.rewriteClientWindowURL = function(url, client) {\\n  var rwURL = this.ensureURL(url, client ? client.url : this.info.originalURL);\\n  if (!rwURL) return url;\\n  if (this.info.prefix) {\\n    return this.info.prefix + 'mp_/' + rwURL;\\n  }\\n  return rwURL;\\n};\\n\\n/**\\n * Mini url rewriter specifically for rewriting web sockets\\n * @param {?string} originalURL\\n * @return {string}\\n */\\nWBWombat.prototype.rewriteWSURL = function(originalURL) {\\n  // If undefined, just return it\\n  if (!originalURL) return originalURL;\\n\\n  var urltype_ = typeof originalURL;\\n  var url = originalURL;\\n\\n  // If object, use toString\\n  if (urltype_ === 'object') {\\n    url = originalURL.toString();\\n  } else if (urltype_ !== 'string') {\\n    return originalURL;\\n  }\\n\\n  // empty string check\\n  if (!url) return url;\\n\\n  var wsScheme = 'ws://';\\n  var wssScheme = 'wss://';\\n  var https = 'https://';\\n\\n  var wbSecure = this.info.prefix.indexOf(https) === 0;\\n  var wbPrefix =\\n    this.info.prefix.replace(\\n      wbSecure ? https : 'http://',\\n      wbSecure ? wssScheme : wsScheme\\n    ) + 'ws_/';\\n  return wbPrefix + url;\\n};\\n\\n/**\\n * Rewrites all URLs in the supplied arguments object\\n * @param {Object} argsObj\\n * @return {Array<string>}\\n */\\nWBWombat.prototype.rewriteArgs = function(argsObj) {\\n  // recreate the original arguments object just with URLs rewritten\\n  var newArgObj = new Array(argsObj.length);\\n  for (var i = 0; i < newArgObj.length; i++) {\\n    newArgObj[i] = this.rewriteURL(argsObj[i]);\\n  }\\n  return newArgObj;\\n};\\n\\n/**\\n * Rewrites the input to one of the Fetch APIs\\n * @param {*|string|Request} input\\n * @return {*|string|Request}\\n */\\nWBWombat.prototype.rewriteFetchApi = function(input) {\\n  var rwInput = input;\\n  switch (typeof input) {\\n    case 'string':\\n      rwInput = this.rewriteURL(input);\\n      break;\\n    case 'object':\\n      if (input.url) {\\n        var new_url = this.rewriteURL(input.url);\\n        if (new_url !== input.url) {\\n          // not much we can do here Request.url is read only\\n          // https://developer.mozilla.org/en-US/docs/Web/API/Request/url\\n          rwInput = new Request(new_url, input);\\n        }\\n      } else if (input.href) {\\n        // it is likely that input is either self.location or self.URL\\n        // we cant do anything here so just let it go\\n        rwInput = input.href;\\n      }\\n      break;\\n  }\\n  return rwInput;\\n};\\n\\n/**\\n * Rewrites the input to one of the Cache APIs\\n * @param {*|string|Request} request\\n * @return {*|string|Request}\\n */\\nWBWombat.prototype.rewriteCacheApi = function(request) {\\n  var rwRequest = request;\\n  if (typeof request === 'string') {\\n    rwRequest = this.rewriteURL(request);\\n  }\\n  return rwRequest;\\n};\\n\\n/**\\n * Applies an override to the importScripts function\\n * @see https://html.spec.whatwg.org/multipage/workers.html#dom-workerglobalscope-importscripts\\n */\\nWBWombat.prototype.initImportScriptsRewrite = function() {\\n  if (!self.importScripts) return;\\n  var wombat = this;\\n  var origImportScripts = self.importScripts;\\n  self.importScripts = function importScripts() {\\n    // rewrite the arguments object and call original function via fn.apply\\n    var rwArgs = wombat.rewriteArgs(arguments);\\n    return origImportScripts.apply(this, rwArgs);\\n  };\\n};\\n\\n/**\\n * Applies overrides to the XMLHttpRequest.open and XMLHttpRequest.responseURL\\n * in order to ensure URLs are rewritten.\\n *\\n * Applies an override to window.fetch in order to rewrite URLs and URLs of\\n * the supplied Request objects used as arguments to fetch.\\n *\\n * Applies overrides to window.Request, window.Response, window.EventSource,\\n * and window.WebSocket in order to ensure URLs they operate on are rewritten.\\n *\\n * @see https://xhr.spec.whatwg.org/\\n * @see https://fetch.spec.whatwg.org/\\n * @see https://html.spec.whatwg.org/multipage/web-sockets.html#websocket\\n * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface\\n */\\nWBWombat.prototype.initHTTPOverrides = function() {\\n  var wombat = this;\\n  if (\\n    self.XMLHttpRequest &&\\n    self.XMLHttpRequest.prototype &&\\n    self.XMLHttpRequest.prototype.open\\n  ) {\\n    var oXHROpen = self.XMLHttpRequest.prototype.open;\\n    self.XMLHttpRequest.prototype.open = function open(\\n      method,\\n      url,\\n      async,\\n      user,\\n      password\\n    ) {\\n      var rwURL = wombat.rewriteURL(url);\\n      var openAsync = true;\\n      if (async != null && !async) openAsync = false;\\n      oXHROpen.call(this, method, rwURL, openAsync, user, password);\\n      if (rwURL.indexOf('data:') === -1) {\\n        this.setRequestHeader('X-Pywb-Requested-With', 'XMLHttpRequest');\\n      }\\n    };\\n  }\\n\\n  if (self.fetch != null) {\\n    // this fetch is Worker.fetch\\n    var orig_fetch = self.fetch;\\n    self.fetch = function fetch(input, init_opts) {\\n      var rwInput = wombat.rewriteFetchApi(input);\\n      var newInitOpts = init_opts || {};\\n      newInitOpts['credentials'] = 'include';\\n      return orig_fetch.call(this, rwInput, newInitOpts);\\n    };\\n  }\\n\\n  if (self.Request && self.Request.prototype) {\\n    var orig_request = self.Request;\\n    self.Request = (function(Request_) {\\n      return function Request(input, init_opts) {\\n        var newInitOpts = init_opts || {};\\n        var newInput = wombat.rewriteFetchApi(input);\\n        newInitOpts['credentials'] = 'include';\\n        return new Request_(newInput, newInitOpts);\\n      };\\n    })(self.Request);\\n    self.Request.prototype = orig_request.prototype;\\n  }\\n\\n  if (self.Response && self.Response.prototype) {\\n    var originalRedirect = self.Response.prototype.redirect;\\n    self.Response.prototype.redirect = function redirect(url, status) {\\n      var rwURL = wombat.rewriteUrl(url);\\n      return originalRedirect.call(this, rwURL, status);\\n    };\\n  }\\n\\n  if (self.EventSource && self.EventSource.prototype) {\\n    var origEventSource = self.EventSource;\\n    self.EventSource = (function(EventSource_) {\\n      return function EventSource(url, configuration) {\\n        var rwURL = url;\\n        if (url != null) {\\n          rwURL = wombat.rewriteUrl(url);\\n        }\\n        return new EventSource_(rwURL, configuration);\\n      };\\n    })(self.EventSource);\\n    self.EventSource.prototype = origEventSource.prototype;\\n    Object.defineProperty(self.EventSource.prototype, 'constructor', {\\n      value: self.EventSource\\n    });\\n  }\\n\\n  if (self.WebSocket && self.WebSocket.prototype) {\\n    var origWebSocket = self.WebSocket;\\n    self.WebSocket = (function(WebSocket_) {\\n      return function WebSocket(url, configuration) {\\n        var rwURL = url;\\n        if (url != null) {\\n          rwURL = wombat.rewriteWSURL(url);\\n        }\\n        return new WebSocket_(rwURL, configuration);\\n      };\\n    })(self.WebSocket);\\n    self.WebSocket.prototype = origWebSocket.prototype;\\n    Object.defineProperty(self.WebSocket.prototype, 'constructor', {\\n      value: self.WebSocket\\n    });\\n  }\\n};\\n\\n/**\\n * Applies an override to Clients.openWindow and WindowClient.navigate that rewrites\\n * the supplied URL that represents a controlled window\\n * @see https://w3c.github.io/ServiceWorker/#window-client-interface\\n * @see https://w3c.github.io/ServiceWorker/#clients-interface\\n */\\nWBWombat.prototype.initClientApisOverride = function() {\\n  var wombat = this;\\n  if (\\n    self.Clients &&\\n    self.Clients.prototype &&\\n    self.Clients.prototype.openWindow\\n  ) {\\n    var oClientsOpenWindow = self.Clients.prototype.openWindow;\\n    self.Clients.prototype.openWindow = function openWindow(url) {\\n      var rwURL = wombat.rewriteClientWindowURL(url);\\n      return oClientsOpenWindow.call(this, rwURL);\\n    };\\n  }\\n\\n  if (\\n    self.WindowClient &&\\n    self.WindowClient.prototype &&\\n    self.WindowClient.prototype.navigate\\n  ) {\\n    var oWinClientNavigate = self.WindowClient.prototype.navigate;\\n    self.WindowClient.prototype.navigate = function navigate(url) {\\n      var rwURL = wombat.rewriteClientWindowURL(url, this);\\n      return oWinClientNavigate.call(this, rwURL);\\n    };\\n  }\\n};\\n\\n/**\\n * Applies overrides to the CacheStorage and Cache interfaces in order\\n * to rewrite the URLs they operate on\\n * @see https://w3c.github.io/ServiceWorker/#cachestorage\\n * @see https://w3c.github.io/ServiceWorker/#cache-interface\\n */\\nWBWombat.prototype.initCacheApisOverride = function() {\\n  var wombat = this;\\n  if (\\n    self.CacheStorage &&\\n    self.CacheStorage.prototype &&\\n    self.CacheStorage.prototype.match\\n  ) {\\n    var oCacheStorageMatch = self.CacheStorage.prototype.match;\\n    self.CacheStorage.prototype.match = function match(request, options) {\\n      var rwRequest = wombat.rewriteCacheApi(request);\\n      return oCacheStorageMatch.call(this, rwRequest, options);\\n    };\\n  }\\n\\n  if (self.Cache && self.Cache.prototype) {\\n    if (self.Cache.prototype.match) {\\n      var oCacheMatch = self.Cache.prototype.match;\\n      self.Cache.prototype.match = function match(request, options) {\\n        var rwRequest = wombat.rewriteCacheApi(request);\\n        return oCacheMatch.call(this, rwRequest, options);\\n      };\\n    }\\n\\n    if (self.Cache.prototype.matchAll) {\\n      var oCacheMatchAll = self.Cache.prototype.matchAll;\\n      self.Cache.prototype.matchAll = function matchAll(request, options) {\\n        var rwRequest = wombat.rewriteCacheApi(request);\\n        return oCacheMatchAll.call(this, rwRequest, options);\\n      };\\n    }\\n\\n    if (self.Cache.prototype.add) {\\n      var oCacheAdd = self.Cache.prototype.add;\\n      self.Cache.prototype.add = function add(request, options) {\\n        var rwRequest = wombat.rewriteCacheApi(request);\\n        return oCacheAdd.call(this, rwRequest, options);\\n      };\\n    }\\n\\n    if (self.Cache.prototype.addAll) {\\n      var oCacheAddAll = self.Cache.prototype.addAll;\\n      self.Cache.prototype.addAll = function addAll(requests) {\\n        var rwRequests = requests;\\n        if (Array.isArray(requests)) {\\n          rwRequests = new Array(requests.length);\\n          for (var i = 0; i < requests.length; i++) {\\n            rwRequests[i] = wombat.rewriteCacheApi(requests[i]);\\n          }\\n        }\\n        return oCacheAddAll.call(this, rwRequests);\\n      };\\n    }\\n\\n    if (self.Cache.prototype.put) {\\n      var oCachePut = self.Cache.prototype.put;\\n      self.Cache.prototype.put = function put(request, response) {\\n        var rwRequest = wombat.rewriteCacheApi(request);\\n        return oCachePut.call(this, rwRequest, response);\\n      };\\n    }\\n\\n    if (self.Cache.prototype.delete) {\\n      var oCacheDelete = self.Cache.prototype.delete;\\n      self.Cache.prototype.delete = function newCacheDelete(request, options) {\\n        var rwRequest = wombat.rewriteCacheApi(request);\\n        return oCacheDelete.call(this, rwRequest, options);\\n      };\\n    }\\n\\n    if (self.Cache.prototype.keys) {\\n      var oCacheKeys = self.Cache.prototype.keys;\\n      self.Cache.prototype.keys = function keys(request, options) {\\n        var rwRequest = wombat.rewriteCacheApi(request);\\n        return oCacheKeys.call(this, rwRequest, options);\\n      };\\n    }\\n  }\\n};\\n\\nself.WBWombat = WBWombat;\\n\");\n\n//# sourceURL=webpack:///./node_modules/@webrecorder/wombat/src/wombatWorkers.js?");

/***/ })

/******/ })));