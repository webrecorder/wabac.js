import { Collection } from './collection.js';
import { parseHAR, HARCache } from './harcache.js';

class ReplayIndex
{
    constructor() {
        navigator.serviceWorker.addEventListener("message", (event) => {
            switch (event.data.msg_type) {
                case "collAdded":
                    console.log("Collection added: " + event.data.prefix);
                    break;

                case "listAll":
                    console.log("listAll");
                    this.addCollections(event.data.colls);
                    break;
            }
        });


        const swInit = new Promise(resolve => {
          if (navigator.serviceWorker.controller) return resolve();
          navigator.serviceWorker.addEventListener('controllerchange', e => resolve());
        });

        swInit.then(() => { this.init() });
    }

    init() {
        const us = new URLSearchParams(window.location.search);
        let any = false;

        for (let entry of us.entries()) {
            if (entry[0].startsWith("coll_")) {
                any = true;
                this.initColl(entry[0].slice("coll_".length), entry[1]);
            }
        }

        if (!any) {
            navigator.serviceWorker.controller.postMessage({"msg_type": "listAll"});
        }
    }

    initColl(name, source) {
        window.fetch(source).then(response => {
            return response.json();
        }).then(harjson => {
            const coll = new Collection(name, new HARCache(harjson));

            navigator.serviceWorker.controller.postMessage({"msg_type": "addColl", "collection": coll});
        });
    }


    processFile(files) {
        if (navigator.serviceWorker.controller) {
            parseHAR(files[0]).then(function(har) { 
                const coll = new Collection(document.querySelector("#coll-name").value, har);
                navigator.serviceWorker.controller.postMessage({"msg_type": "addColl", "collection": coll});
                console.log("Setting coll: " + coll);
            });
        }
    }

    addCollections(collList) {
        document.querySelector("#colls").innerHTML = "";
        for (let coll of collList) {
            this.addCollection(coll);
        }
    }

    addCollection(coll) {
        let content = `<h3>${coll.name}</h3><ul>`;

        for (let page of coll.pageList) {
            let href = coll.prefix;
            if (page.ts) {
                href += page.ts + "/";
            }
            href += page.url;
            content += `<li><a href="${href}">${page.url}</a></li>`
        }

        content += '</ul>'
        let collDiv = document.createElement("div");
        collDiv.innerHTML = content;

        document.querySelector("#colls").appendChild(collDiv);
    }
}


export { ReplayIndex };
