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
/*! exports provided: ReplayIndex, initCollection, initSW */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, \"ReplayIndex\", function() { return ReplayIndex; });\n/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, \"initCollection\", function() { return initCollection; });\n/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, \"initSW\", function() { return initSW; });\nclass ReplayIndex\n{\n    constructor() {\n        navigator.serviceWorker.addEventListener(\"message\", (event) => {\n            switch (event.data.msg_type) {\n                case \"collAdded\":\n                    console.log(\"Collection added: \" + event.data.prefix);\n                    break;\n\n                case \"listAll\":\n                    this.addCollections(event.data.colls);\n                    break;\n            }\n        });\n\n\n        const swInit = new Promise(resolve => {\n          if (navigator.serviceWorker.controller) return resolve();\n          navigator.serviceWorker.addEventListener('controllerchange', e => resolve());\n        });\n\n        swInit.then(() => { this.init() });\n    }\n\n    init() {\n        const us = new URLSearchParams(window.location.search);\n        let any = false;\n\n        for (let entry of us.entries()) {\n            if (entry[0].startsWith(\"coll_\")) {\n                any = true;\n\n                const name = entry[0].slice(\"coll_\".length);\n                const source = entry[1];\n\n                const files = [{\"name\": source, \"url\": source}];\n                navigator.serviceWorker.controller.postMessage({\"msg_type\": \"addColl\", name, files});\n            }\n        }\n\n        if (!any) {\n            navigator.serviceWorker.controller.postMessage({\"msg_type\": \"listAll\"});\n        }\n    }\n\n\n    processFile(localFiles) {\n        if (!navigator.serviceWorker.controller) {\n            console.log(\"No Service Worker!\");\n        }\n\n        let files = [];\n\n        //const coll = new Collection(document.querySelector(\"#coll-name\").value, har);\n        const name = document.querySelector(\"#coll-name\").value;\n                \n        for (let file of localFiles) {\n            files.push({\"name\": file.name, \"url\": URL.createObjectURL(file)});\n        }\n        navigator.serviceWorker.controller.postMessage({\"msg_type\": \"addColl\", name, files});\n    }\n\n    addCollections(collList) {\n        document.querySelector(\"#colls\").innerHTML = \"\";\n        for (let coll of collList) {\n            this.addCollection(coll);\n        }\n    }\n\n    addCollection(coll) {\n        let content = `<h3>${coll.name}</h3><ul>`;\n\n        for (let page of coll.pageList) {\n            let href = coll.prefix;\n            if (page.timestamp) {\n                href += page.timestamp + \"/\";\n            }\n            href += page.url;\n            content += `<li><a href=\"${href}\">${page.title || page.url}</a></li>`\n        }\n\n        content += '</ul>'\n        let collDiv = document.createElement(\"div\");\n        collDiv.innerHTML = content;\n\n        document.querySelector(\"#colls\").appendChild(collDiv);\n    }\n}\n\nfunction initCollection(collDef, autoLoad) {\n    const swInit = new Promise(resolve => {\n        if (navigator.serviceWorker.controller) return resolve();\n        navigator.serviceWorker.addEventListener('controllerchange', e => resolve());\n    });\n\n    swInit.then(() => {\n        // auto-load url in the hashtag!\n        if (autoLoad && window.location.hash && window.location.hash.startsWith(\"#/\" + collDef.name)) {\n            navigator.serviceWorker.addEventListener(\"message\", (event) => {\n                switch (event.data.msg_type) {\n                    case \"collAdded\":\n                        window.location.reload();\n                }\n            });\n        }\n\n        navigator.serviceWorker.controller.postMessage({\"msg_type\": \"addColl\", ...collDef});\n    });\n}\n\nfunction initSW(relUrl) {\n    if (!navigator.serviceWorker) {\n        return Promise.reject('Service workers are not supported');\n    }\n\n    // Register SW in current path scope (if not '/' use curr directory)\n    let path = window.location.origin + window.location.pathname;\n\n    if (!path.endsWith(\"/\")) {\n        path = path.slice(0, path.lastIndexOf(\"/\") + 1);\n    }\n\n    let url = path + relUrl;\n\n    return new Promise((resolve, reject) => {\n        window.fetch(url, {\"mode\": \"cors\"}).then(resp => {\n            if (!resp.url.startsWith(path)) {\n                reject(\"Service Worker in wrong scope!\")\n            }\n            return resp.url;\n        }).then((swUrl) => {\n            return navigator.serviceWorker.register(swUrl, {scope: path});\n        }).then((registration) => {\n            console.log('Service worker registration succeeded:', registration);\n            resolve(\"\");\n        }).catch((error) => {\n            console.log('Service worker registration failed:', error);\n            reject(error);\n        });\n    });\n}\n\n\n\n\n\n//# sourceURL=webpack:///./src/page.js?");

/***/ })

/******/ })));