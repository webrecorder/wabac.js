document.addEventListener("DOMContentLoaded", initTemplates);

async function initTemplates() {
    let templates = document.querySelectorAll("template[data-archive-name][data-archive-file]");

    try {
      await initSW("sw.js", "/");
    } catch (e) {
      console.log("no sw");
    }

    const style = document.createElement("style");
    style.innerHTML = `
    .emp-header {
      background-color: lightblue;
      padding: 8px;
      padding-top: 12px;
    }

    .emp-status {
      font-style: italic;
      padding-left: 20px;
    }

    .emp-container {
      background-color: aliceblue;
      padding-top: 4px;
    }

    .emp-tab {
      padding: 8px;
      border-top-left-radius: 6px;
      border-top-right-radius: 6px;
    }

    a.emp-active {
      text-decoration: none !important;
      color: inherit !important;
      font-weight: bold;
      background-color: aliceblue;
      cursor: auto;
    }

    a.emp-active:hover {
      text-decoration: none !important;
    }
    `;

    document.head.appendChild(style);

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data.msg_type === "collAdded") {
        const name = event.data.name;
        const iframe = document.querySelector(`iframe[data-archive="${name}"]`);
        const digest = iframe.getAttribute("data-digest");
        const replayOrigin = iframe.parentElement.parentElement.getAttribute("data-replay-origin") || window.location.origin;
        iframe.src = replayOrigin + "/" + name + "/mp_/blob:" + digest;
      }
    });

    for (let template of templates) {
      const fileURL = new URL(template.getAttribute("data-archive-file"), window.location.origin).href;
      const name = template.getAttribute("data-archive-name");

      const width = template.getAttribute("data-width") || "auto";
      const height = template.getAttribute("data-height") || "auto";

      const text = template.innerHTML.trim();

      //const digest = //await digestMessage(text, 'SHA-256');
      const digest = template.getAttribute("data-digest");

      const files = [{ "name": fileURL, "url": fileURL }];

      navigator.serviceWorker.controller.postMessage({ "msg_type": "addColl", name, files });

      const insertHTML = `
  <span class="emp-header">
  <a href="#" class="emp-tab emp-archived">Archived</a>
  <a href="#" class="emp-tab emp-live">Live</a>
  <span class="emp-status"></span>
  </span>
  <div class="emp-container emp-archived">
    <iframe data-archive="${name}" data-digest="${digest}" style="width: ${width}; height: ${height}; border: 0px"></iframe>
  </div>
  <div class="emp-container emp-live">
  </div>
      `;

      const div = document.createElement("div");
      div.innerHTML = insertHTML;

      template.insertAdjacentElement('beforebegin', div);

      const iframe = div.querySelector("iframe");
      const status = div.querySelector("span.emp-status");

      const live = div.querySelector("div.emp-container.emp-live");
      const archived = div.querySelector("div.emp-container.emp-archived");

      //const liveNode = document.importNode(template, true);
      live.appendChild(template.content);

      const btnLive = div.querySelector("a.emp-tab.emp-live");
      const btnArchived = div.querySelector("a.emp-tab.emp-archived");

      btnArchived.addEventListener("click", (event) => {
        live.style.display = "none";
        archived.style.display = "";
        btnArchived.classList.add("emp-active");
        btnLive.classList.remove("emp-active");
        status.innerText = iframe.getAttribute("data-ts");
        event.preventDefault();
        return false;
      });

      btnLive.addEventListener("click", (event) => {
        live.style.display = "";
        archived.style.display = "none";
        btnLive.classList.add("emp-active");
        btnArchived.classList.remove("emp-active");
        status.innerText = "Live Embed";
        event.preventDefault();
        return false;
      });
    }

    window.addEventListener("message", (event) => {
      const iframes = document.querySelectorAll("iframe[data-archive]");

      for (var iframe of iframes) {
        if (iframe.src.indexOf(event.data.url) > 0) {
          iframe.setAttribute("data-ts", "Archived On: " + tsToDate(event.data.ts));
          iframe.parentElement.parentElement.querySelector("a.emp-tab.emp-archived").click();
        }
      }
    });
};


async function digestMessage(message, hashtype) {
  const msgUint8 = new TextEncoder().encode(message);                           // encode as (utf-8) Uint8Array
  const hashBuffer = await crypto.subtle.digest(hashtype, msgUint8);           // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer));                     // convert buffer to byte array
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
  return hashHex;
}

function tsToDate(ts) {
  if (!ts) {
    return "";
  }

  if (ts.length < 14) {
    ts += "00000000000000".substr(ts.length);
  }

  const datestr = (ts.substring(0, 4) + "-" +
    ts.substring(4, 6) + "-" +
    ts.substring(6, 8) + "T" +
    ts.substring(8, 10) + ":" +
    ts.substring(10, 12) + ":" +
    ts.substring(12, 14) + "-00:00");

  return new Date(datestr);
};

function initSW(relUrl, path) {
  const loc = window.location;

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
  if (!path) {
    path = loc.origin + loc.pathname;
  } else {
    path = new URL(path, window.location.href).href;
  }

  if (!path.endsWith("/")) {
    path = path.slice(0, path.lastIndexOf("/") + 1);
  }

  let url = path + relUrl;

  return new Promise((resolve, reject) => {
    window.fetch(url, { "mode": "cors" }).then(resp => {
      if (!resp.url.startsWith(path)) {
        reject("Service Worker in wrong scope!")
      }
      return resp.url;
    }).then((swUrl) => {
      return navigator.serviceWorker.register(swUrl, { scope: path });
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

