const proxyPrefix = "https://wabac-cors-proxy.webrecorder.workers.dev/proxy/";


class WabacLiveProxy
{
  constructor() {
    this.url = "";
  }

  async init() {
    const scope = "./";

    // also add inject of custom.js as a script into each replayed page
    await navigator.serviceWorker.register("./sw.js?injectScripts=./custom.js", {scope});

    let initedResolve = null;

    const inited = new Promise((resolve) => initedResolve = resolve);

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data.msg_type === "collAdded") {
        // the replay is ready to be loaded when this message is received
        initedResolve();
      }
    });

    const baseUrl = new URL(window.location);
    baseUrl.hash = "";

    const msg = {
      msg_type: "addColl",
      name: "liveproxy",
      type: "live",
      file: {"sourceUrl": `proxy:${proxyPrefix}`},
      skipExisting: false,
      extraConfig: {
        "prefix": proxyPrefix, 
        "isLive": true,
        "allowBody": true,
        "baseUrl": baseUrl.href,
        "baseUrlHashReplay": true,
        "noPostToGet": true
      },
    };

    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        navigator.serviceWorker.controller.postMessage(msg);
      });
    } else {
      navigator.serviceWorker.controller.postMessage(msg);
    }

    if (inited) {
      await inited;
    }

    window.addEventListener("load", () => {
      this.onHashChange();
    });

    window.addEventListener("hashchange", () => {
      this.onHashChange();
    });

    this.onHashChange();
  }

  onHashChange () {
    const m = window.location.hash.slice(1).match(/\/?(?:([\d]+)\/)?(.*)/);

    const url = m && m[2] || "https://example.com/";
    
    // don't change if same url
    if (url === this.url) {
      return;
    }

    let iframeUrl = `/w/liveproxy/mp_/${url}`;

    const iframe = document.querySelector("#content");
    iframe.src = iframeUrl;

    this.url = url;

    window.location.hash = `#${url}`;
  }
}

new WabacLiveProxy().init();
