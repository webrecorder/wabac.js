!function(e,r){for(var t in r)e[t]=r[t]}(self,function(e){var r={};function t(o){if(r[o])return r[o].exports;var n=r[o]={i:o,l:!1,exports:{}};return e[o].call(n.exports,n,n.exports,t),n.l=!0,n.exports}return t.m=e,t.c=r,t.d=function(e,r,o){t.o(e,r)||Object.defineProperty(e,r,{enumerable:!0,get:o})},t.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},t.t=function(e,r){if(1&r&&(e=t(e)),8&r)return e;if(4&r&&"object"==typeof e&&e&&e.__esModule)return e;var o=Object.create(null);if(t.r(o),Object.defineProperty(o,"default",{enumerable:!0,value:e}),2&r&&"string"!=typeof e)for(var n in e)t.d(o,n,function(r){return e[r]}.bind(null,n));return o},t.n=function(e){var r=e&&e.__esModule?function(){return e.default}:function(){return e};return t.d(r,"a",r),r},t.o=function(e,r){return Object.prototype.hasOwnProperty.call(e,r)},t.p="",t(t.s=62)}({62:function(e,r,t){"use strict";t.r(r),t.d(r,"initSW",function(){return o}),t.d(r,"Page",function(){return n});let o=t(63),n=t(64)},63:function(e,r){"serviceWorker"in navigator?navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(function(e){console.log("Service worker registration succeeded:",e)},function(e){console.log("Service worker registration failed:",e)}):console.log("Service workers are not supported.")},64:function(e,r,t){"use strict";t.r(r),t.d(r,"ReplayIndex",function(){return o});class o{constructor(){navigator.serviceWorker.addEventListener("message",e=>{switch(e.data.msg_type){case"collAdded":console.log("Collection added: "+e.data.prefix);break;case"listAll":this.addCollections(e.data.colls)}}),new Promise(e=>{if(navigator.serviceWorker.controller)return e();navigator.serviceWorker.addEventListener("controllerchange",r=>e())}).then(()=>{this.init()})}init(){const e=new URLSearchParams(window.location.search);let r=!1;for(let t of e.entries())t[0].startsWith("coll_")&&(r=!0,this.initColl(t[0].slice("coll_".length),t[1]));r||navigator.serviceWorker.controller.postMessage({msg_type:"listAll"})}initColl(e,r){const t=[{name:r,url:r}];navigator.serviceWorker.controller.postMessage({msg_type:"addColl",name:e,files:t})}processFile(e){navigator.serviceWorker.controller||console.log("No Service Worker!");let r=[];const t=document.querySelector("#coll-name").value;for(let t of e)r.push({name:t.name,url:URL.createObjectURL(t)});navigator.serviceWorker.controller.postMessage({msg_type:"addColl",name:t,files:r})}addCollections(e){document.querySelector("#colls").innerHTML="";for(let r of e)this.addCollection(r)}addCollection(e){let r=`<h3>${e.name}</h3><ul>`;for(let t of e.pageList){let o=e.prefix;t.ts&&(o+=t.ts+"/"),r+=`<li><a href="${o+=t.url}">${t.url}</a></li>`}r+="</ul>";let t=document.createElement("div");t.innerHTML=r,document.querySelector("#colls").appendChild(t)}}}}));