function processFile(files) {
	if (navigator.serviceWorker.controller) {
		parseHAR(files[0]).then(function(har) { 
			const coll = new Collection(document.querySelector("#coll-name").value, har);
			navigator.serviceWorker.controller.postMessage({"msg_type": "addColl", "collection": coll});
			console.log("Setting coll: " + coll);
		});
	}
}

function addCollections(collList) {
	document.querySelector("#colls").innerHTML = "";
	for (coll of collList) {
		addCollection(coll);
	}
}

function addCollection(coll) {
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



navigator.serviceWorker.addEventListener("message", function(event) {
	switch (event.data.msg_type) {
		case "collAdded":
			console.log("Collection added: " + event.data.prefix);
			break;

		case "listAll":
			console.log("listAll");
			addCollections(event.data.colls);
			break;
	}
});


const swInit = new Promise(resolve => {
  if (navigator.serviceWorker.controller) return resolve();
  navigator.serviceWorker.addEventListener('controllerchange', e => resolve());
});

swInit.then(() => {
  navigator.serviceWorker.controller.postMessage({"msg_type": "listAll"});
});