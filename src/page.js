class ReplayIndex
{
    constructor() {
        const us = new URLSearchParams(window.location.search);
        let any = false;

        navigator.serviceWorker.addEventListener("message", (event) => {
            switch (event.data.msg_type) {
                case "collAdded":
                    console.log("Collection added: " + event.data.prefix);
                    break;

                case "listAll":
                    this.addCollections(event.data.colls);
                    if (us.get("url")) {
                        const redirUrl = new URL(us.get("url"), window.location.href);
                        window.location.href = redirUrl.href;
                    }
                    break;
            }
        });

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

        document.querySelector("#loadingName").innerText = files[0].name;
        document.querySelector("#loading").style.display = "";
    }

    addCollections(collList) {
        document.querySelector("#colls").innerHTML = "";
        document.querySelector("#loading").style.display = "none";

        if (collList.length == 0) {
            document.querySelector("#colls").innerHTML = "<i>No Collections Yet!</i>";
            return;
        }

        for (let coll of collList) {
            this.addCollection(coll);
        }
    }

    addCollection(coll) {
        let content = `
<div class="collHead"><span class="collName">/${coll.name}</span>
<span class="sourceDisplay">Source: <span>${coll.sourceName}</span></span>
<a href="#" data-coll="${coll.name}" onclick="Page.removeColl(event)" class="removeColl">&#x2716;&#xFE0F;</a> 
</div>`;

        if (coll.pageList && coll.pageList.length) {
            content += '<div class="pageList"><h3>Pages</h3><ul>';

            for (let page of coll.pageList) {
                let href = coll.prefix;
                if (page.timestamp) {
                    href += page.timestamp + "/";
                }
                href += page.url;
                content += `<li><a href="${href}">${page.title || page.url}</a></li>`
            }

            content += '</ul></div>';
        }

        content += `
<form class="formSearch" data-prefix="${coll.prefix}" onsubmit="Page.goToColl(event)">
<h3>Search Collection:</h3>
    <input class="collUrl" id="${coll.name}_url" name="url" type="text" placeholder="URL" required />
    <input class="collTimestamp" id="${coll.name}_timestamp" name="timestamp" type="text" placeholder="Timestamp" />
    <button type="submit">Go BAC!</button>
</form>`;

        let collDiv = document.createElement("div");
        collDiv.classList.add("collDiv");
        collDiv.innerHTML = content;

        document.querySelector("#colls").appendChild(collDiv);
    }
}

function initCollection(collDef, autoLoad) {
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
            if (navigator.serviceWorker.controller) {
                resolve(null);
            }
            navigator.serviceWorker.addEventListener('controllerchange', e => resolve(null));
        }).catch((error) => {
            console.log('Service worker registration failed:', error);
            reject(error);
        });
    });
}

function getMountedArchive(loc) {
    if (!window) {
        return null;
    }

    let m = loc.href.match(/(\/[^/]+\/)[\d]+\/https?:/);
    if (!m) {
        return null;
    }

    let info = {"replayPrefix": loc.href.substring(0, m.index + m[1].length), "hostname": loc.hostname};

    // special cases for some known archives
    switch (info.hostname) {
        case "web.archive.org":
            info.redirMod = "id_";
            break;

        case "localhost":
            info.replayPrefix = loc.origin + "/pywb/";
            break;
    }

    return info;
}

function removeColl(event) {
    event.preventDefault();

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({"msg_type": "removeColl",
                                                        "name": event.target.getAttribute("data-coll")});
    }

    return false;
}

function goToColl(event) {
    event.preventDefault();
    const form = event.target;
    let url = form.querySelector(".collUrl").value;
    if (!url) {
        return;
    }
    if (!url.startsWith("http:") && !url.startsWith("https:")) {
        url = "http://" + url;
    }
    let timestamp = form.querySelector(".collTimestamp").value || "";
    timestamp = timestamp.replace(/[^\d]+/g, '');

    let newUrl = form.getAttribute("data-prefix") + timestamp;

    const isHashNav = (newUrl.indexOf("#") >= 0);

    if (timestamp) {
        newUrl += (isHashNav ? "|" : "/");
    }

    newUrl += url;

    const loc = window["loc" + "ation"];
    loc.href = newUrl;
    if (isHashNav) {
        loc.reload();   
    }
    return false;
}

function main() {
    const ation = "ation";
    const loc = window["loc" + ation];

    const mountInfo = getMountedArchive(loc);

    initSW("sw.js").then(function() {
        if (mountInfo) {
            initCollection({"name": "web", "root": true, "remote": mountInfo}, true);
        }

        const index = new Page.ReplayIndex();

        document.querySelector("#file-input").addEventListener("change", function() {
            index.processFile(this.files);
        });

    }).catch(function(error) {
        const err = document.querySelector("#error");
        err.innerText = error;
        err.style.display = "";
        console.warn(error);
    });
}

document.addEventListener("DOMContentLoaded", main, {"once": true});


export { ReplayIndex, goToColl, removeColl };
