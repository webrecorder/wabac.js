class ReplayIndex
{
    constructor() {
        navigator.serviceWorker.addEventListener("message", (event) => {
            switch (event.data.msg_type) {
                case "collAdded":
                    console.log("Collection added: " + event.data.prefix);
                    break;

                case "listAll":
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

                const name = entry[0].slice("coll_".length);
                const source = entry[1];

                const files = [{"name": source, "url": source}];
                navigator.serviceWorker.controller.postMessage({"msg_type": "addColl", name, files});
            }
        }

        if (!any) {
            navigator.serviceWorker.controller.postMessage({"msg_type": "listAll"});
        }
    }


    processFile(localFiles) {
        if (!navigator.serviceWorker.controller) {
            console.log("No Service Worker!");
        }

        let files = [];

        //const coll = new Collection(document.querySelector("#coll-name").value, har);
        const name = document.querySelector("#coll-name").value;
                
        for (let file of localFiles) {
            files.push({"name": file.name, "url": URL.createObjectURL(file)});
        }
        navigator.serviceWorker.controller.postMessage({"msg_type": "addColl", name, files});
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
