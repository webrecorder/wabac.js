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
            if (page.timestamp) {
                href += page.timestamp + "/";
            }
            href += page.url;
            content += `<li><a href="${href}">${page.title || page.url}</a></li>`
        }

        content += '</ul>'
        let collDiv = document.createElement("div");
        collDiv.innerHTML = content;

        document.querySelector("#colls").appendChild(collDiv);
    }
}

function initCollection(collDef, autoLoad) {
    const swInit = new Promise(resolve => {
        if (navigator.serviceWorker.controller) return resolve();
        navigator.serviceWorker.addEventListener('controllerchange', e => resolve());
    });

    swInit.then(() => {
        // auto-load url in the hashtag!
        if (autoLoad && window.location.hash && window.location.hash.startsWith("#/")) {
            navigator.serviceWorker.addEventListener("message", (event) => {
                switch (event.data.msg_type) {
                    case "collAdded":
                        window.location.reload();
                }
            });
        }

        navigator.serviceWorker.controller.postMessage({"msg_type": "addColl", ...collDef});
    });
}

function initSW(relUrl) {
    if (!navigator.serviceWorker) {
        return Promise.reject('Service workers are not supported');
    }

    // Register SW in current path scope (if not '/' use curr directory)
    let path = window.location.origin + window.location.pathname;

    if (!path.endsWith("/")) {
        path = path.slice(0, path.lastIndexOf("/") + 1);
    }

    let url = path + relUrl;

    return new Promise((resolve, reject) => {
        window.fetch(url, {"mode": "cors"}).then(resp => {
            if (!resp.url.startsWith(path)) {
                reject("Service Worker in wrong scope!")
            }
            return resp.url;
        }).then((swUrl) => {
            return navigator.serviceWorker.register(swUrl, {scope: path});
        }).then((registration) => {
            console.log('Service worker registration succeeded:', registration);
            resolve("");
        }).catch((error) => {
            console.log('Service worker registration failed:', error);
            reject(error);
        });
    });
}


export { ReplayIndex, initCollection, initSW };
