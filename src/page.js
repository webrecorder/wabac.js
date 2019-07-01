import flatpickr from "flatpickr";

const ation = "ation";
const loc = window["loc" + ation];

class ReplayIndex
{
    constructor() {
        const us = new URLSearchParams(loc.search);
        let any = false;

        navigator.serviceWorker.addEventListener("message", (event) => {
            switch (event.data.msg_type) {
                case "collAdded":
                    console.log("Collection added: " + event.data.prefix);
                    break;

                case "listAll":
                    this.addCollections(event.data.colls);
                    if (us.get("url")) {
                        const redirUrl = new URL(us.get("url"), loc.href);
                        setTimeout(() => { loc.href = redirUrl.href; }, 100);
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

                // todo: support multiple collections loading
                document.querySelector("#loadingName").innerText = source;
                document.querySelector("#loading").style.display = "";
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
<div class="collHead">
<a href="#" data-coll="${coll.name}" onclick="Page.removeColl(event)" class="removeColl">&#x2716;&#xFE0F;</a>
<span class="collName">/${coll.name}/</span><br>
<span class="sourceDisplay">Source: <span>${coll.sourceName}</span></span>
</div>
`;

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

        const date = new Date();
        date.setFullYear(date.getFullYear() - 10);

        flatpickr("#" + coll.name + "_timestamp", {
            enableTime: true,
            dateFormat: "Y-m-d H:i:S",
            enableSeconds: true,
            allowInput: true,
            defaultDate: date,
        });
    }
}

function initCollection(collDef, autoLoad) {
    // auto-load url in the hashtag!
    if (autoLoad && loc.hash && loc.hash.startsWith("#/")) {
        navigator.serviceWorker.addEventListener("message", (event) => {
            switch (event.data.msg_type) {
                case "collAdded":
                    loc.reload();
            }
        });
    }

    navigator.serviceWorker.controller.postMessage({"msg_type": "addColl", ...collDef});
}

function initSW(relUrl) {
    if (!navigator.serviceWorker) {
        let msg = null;

        if (loc.protocol === "http:") {
            msg = 'Service workers only supported when loading via https://, but this site loaded from: ' + loc.origin;
        } else {
            msg = 'Sorry, Service workers are not supported in this browser'
        }
        return Promise.reject(msg);
    }

    // Register SW in current path scope (if not '/' use curr directory)
    let path = loc.origin + loc.pathname;

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

    const hrefNoQuery = loc.href.split("?", 1)[0];

    let m = hrefNoQuery.match(/(\/[^/]+\/)[\d]+\/https?:/);
    if (!m) {
        return null;
    }

    let info = {"replayPrefix": loc.href.substring(0, m.index + m[1].length), "hostname": loc.hostname};

    // special cases for some known archives
    switch (info.hostname) {
        case "web.archive.org":
            info.redirMod = "id_";
            break;
    }

    // debug: for local testing in pywb on port 8090!
    if (info.replayPrefix === "http://localhost:8090/static/") {
        info.replayPrefix = loc.origin + "/pywb/";
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

    loc.href = newUrl;
    if (isHashNav) {
        loc.reload();
    }
    return false;
}

function main() {
    const mountInfo = getMountedArchive(loc);

    initSW("sw.js").then(function() {
        if (mountInfo) {
            initCollection({"name": "web", "root": true, "remote": mountInfo}, true);

            window.addEventListener("hashchange", (event) => {
                loc.reload();
            });
        }

        const index = new Page.ReplayIndex();

        document.querySelector("#file-input").addEventListener("change", function() {
            index.processFile(this.files);
        });

    }).catch(function(error) {
        const err = document.querySelector("#error");
        err.innerText = "Error: " + error;
        err.style.display = "";
        console.warn(error);
    });
}

document.addEventListener("DOMContentLoaded", main, {"once": true});


export { ReplayIndex, goToColl, removeColl };
