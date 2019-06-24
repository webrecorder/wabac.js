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
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./page-build.js");
/******/ })
/************************************************************************/
/******/ ({

/***/ "./page-build.js":
/*!***********************!*\
  !*** ./page-build.js ***!
  \***********************/
/*! exports provided: Page */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, \"Page\", function() { return Page; });\n//export let Collection = require('./src/collection.js');\n\n//export let HARCache = require('./src/harcache.js');\n\nlet Page = __webpack_require__(/*! ./src/page.js */ \"./src/page.js\");\n\n//export let fs = require('fs');\n\n//export let nodeWarc = require('node-warc');\n\n//export let zlib = require('zlib');\n\n\n//# sourceURL=webpack:///./page-build.js?");

/***/ }),

/***/ "./src/page.js":
/*!*********************!*\
  !*** ./src/page.js ***!
  \*********************/
/*! exports provided: ReplayIndex, goToColl */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, \"ReplayIndex\", function() { return ReplayIndex; });\n/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, \"goToColl\", function() { return goToColl; });\nclass ReplayIndex\n{\n    constructor() {\n        const us = new URLSearchParams(window.location.search);\n        let any = false;\n\n        navigator.serviceWorker.addEventListener(\"message\", (event) => {\n            switch (event.data.msg_type) {\n                case \"collAdded\":\n                    console.log(\"Collection added: \" + event.data.prefix);\n                    break;\n\n                case \"listAll\":\n                    this.addCollections(event.data.colls);\n                    if (us.get(\"url\")) {\n                        const redirUrl = new URL(us.get(\"url\"), window.location.href);\n                        window.location.href = redirUrl.href;\n                    }\n                    break;\n            }\n        });\n\n        for (let entry of us.entries()) {\n            if (entry[0].startsWith(\"coll_\")) {\n                any = true;\n\n                const name = entry[0].slice(\"coll_\".length);\n                const source = entry[1];\n\n                const files = [{\"name\": source, \"url\": source}];\n                navigator.serviceWorker.controller.postMessage({\"msg_type\": \"addColl\", name, files});\n            }\n        }\n\n        if (!any) {\n            navigator.serviceWorker.controller.postMessage({\"msg_type\": \"listAll\"});\n        }\n    }\n\n\n    processFile(localFiles) {\n        if (!navigator.serviceWorker.controller) {\n            console.log(\"No Service Worker!\");\n        }\n\n        let files = [];\n\n        //const coll = new Collection(document.querySelector(\"#coll-name\").value, har);\n        const name = document.querySelector(\"#coll-name\").value;\n                \n        for (let file of localFiles) {\n            files.push({\"name\": file.name, \"url\": URL.createObjectURL(file)});\n        }\n        navigator.serviceWorker.controller.postMessage({\"msg_type\": \"addColl\", name, files});\n    }\n\n    addCollections(collList) {\n        document.querySelector(\"#colls\").innerHTML = \"\";\n\n        if (collList.length == 0) {\n            document.querySelector(\"#colls\").innerHTML = \"<i>None Yet!</i>\";\n            return;\n        }\n\n        for (let coll of collList) {\n            this.addCollection(coll);\n        }\n    }\n\n    addCollection(coll) {\n        let content = `\n<div class=\"collHead\"><span class=\"collName\">/${coll.name}</span>\n<span class=\"sourceDisplay\">Source: <span>${coll.sourceName}</span></span>\n</div>`;\n\n        if (coll.pageList && coll.pageList.length) {\n            content += '<div class=\"pageList\"><h3>Pages</h3><ul>';\n\n            for (let page of coll.pageList) {\n                let href = coll.prefix;\n                if (page.timestamp) {\n                    href += page.timestamp + \"/\";\n                }\n                href += page.url;\n                content += `<li><a href=\"${href}\">${page.title || page.url}</a></li>`\n            }\n\n            content += '</ul></div>';\n        }\n\n        content += `\n<form class=\"formSearch\" data-prefix=\"${coll.prefix}\" onsubmit=\"Page.goToColl(event)\">\n<h3>Search Collection:</h3>\n    <input class=\"collUrl\" id=\"${coll.name}_url\" name=\"url\" type=\"text\" placeholder=\"URL\" required />\n    <input class=\"collTimestamp\" id=\"${coll.name}_timestamp\" name=\"timestamp\" type=\"text\" placeholder=\"Date\" />\n    <button type=\"submit\">Go BAC!</button>\n</form>`;\n\n        let collDiv = document.createElement(\"div\");\n        collDiv.classList.add(\"collDiv\");\n        collDiv.innerHTML = content;\n\n        document.querySelector(\"#colls\").appendChild(collDiv);\n    }\n}\n\nfunction initCollection(collDef, autoLoad) {\n    // auto-load url in the hashtag!\n    if (autoLoad && window.location.hash && window.location.hash.startsWith(\"#/\")) {\n        navigator.serviceWorker.addEventListener(\"message\", (event) => {\n            switch (event.data.msg_type) {\n                case \"collAdded\":\n                    window.location.reload();\n            }\n        });\n    }\n\n    navigator.serviceWorker.controller.postMessage({\"msg_type\": \"addColl\", ...collDef});\n}\n\nfunction initSW(relUrl) {\n    if (!navigator.serviceWorker) {\n        return Promise.reject('Service workers are not supported');\n    }\n\n    // Register SW in current path scope (if not '/' use curr directory)\n    let path = window.location.origin + window.location.pathname;\n\n    if (!path.endsWith(\"/\")) {\n        path = path.slice(0, path.lastIndexOf(\"/\") + 1);\n    }\n\n    let url = path + relUrl;\n\n    return new Promise((resolve, reject) => {\n        window.fetch(url, {\"mode\": \"cors\"}).then(resp => {\n            if (!resp.url.startsWith(path)) {\n                reject(\"Service Worker in wrong scope!\")\n            }\n            return resp.url;\n        }).then((swUrl) => {\n            return navigator.serviceWorker.register(swUrl, {scope: path});\n        }).then((registration) => {\n            console.log('Service worker registration succeeded:', registration);\n            if (navigator.serviceWorker.controller) {\n                resolve(null);\n            }\n            navigator.serviceWorker.addEventListener('controllerchange', e => resolve(null));\n        }).catch((error) => {\n            console.log('Service worker registration failed:', error);\n            reject(error);\n        });\n    });\n}\n\nfunction getMountedArchive(loc) {\n    if (!window) {\n        return null;\n    }\n\n    let m = loc.href.match(/(\\/[^/]+\\/)[\\d]+\\/https?:/);\n    if (!m) {\n        return null;\n    }\n\n    let info = {\"replayPrefix\": loc.href.substring(0, m.index + m[1].length), \"hostname\": loc.hostname};\n\n    // special cases for some known archives\n    switch (info.hostname) {\n        case \"web.archive.org\":\n            info.redirMod = \"id_\";\n            break;\n\n        case \"localhost\":\n            info.replayPrefix = loc.origin + \"/pywb/\";\n            break;\n    }\n\n    return info;\n}\n\nfunction goToColl(event) {\n    event.preventDefault();\n    const form = event.target;\n    let url = form.querySelector(\".collUrl\").value;\n    if (!url) {\n        return;\n    }\n    if (!url.startsWith(\"http:\") && !url.startsWith(\"https:\")) {\n        url = \"http://\" + url;\n    }\n    let timestamp = form.querySelector(\".collTimestamp\").value || \"\";\n    timestamp = timestamp.replace(/[^\\d]+/g, '');\n\n    let newUrl = form.getAttribute(\"data-prefix\") + timestamp;\n\n    const isHashNav = (newUrl.indexOf(\"#\") >= 0);\n\n    if (timestamp) {\n        newUrl += isHashNav ? \"|\" : \"/\";\n    }\n\n    newUrl += url;\n\n    const loc = window[\"loc\" + \"ation\"];\n    loc.href = newUrl;\n    if (isHashNav) {\n        loc.reload();   \n    }\n    return false;\n}\n\nfunction main() {\n    const ation = \"ation\";\n    const loc = window[\"loc\" + ation];\n\n    const mountInfo = getMountedArchive(loc);\n\n    initSW(\"sw.js\").then(function() {\n        if (mountInfo) {\n            initCollection({\"name\": \"web\", \"root\": true, \"remote\": mountInfo}, true);\n        }\n\n        const index = new Page.ReplayIndex();\n\n        document.querySelector(\"#file-input\").addEventListener(\"change\", function() {\n            index.processFile(this.files);\n        });\n\n    }).catch(function(error) {\n        const err = document.querySelector(\"#error\");\n        err.innerText = error;\n        err.style.display = \"\";\n        console.warn(error);\n    });\n}\n\ndocument.addEventListener(\"DOMContentLoaded\", main, {\"once\": true});\n\n\n\n\n\n//# sourceURL=webpack:///./src/page.js?");

/***/ })

/******/ })));