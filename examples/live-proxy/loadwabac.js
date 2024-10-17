const proxyPrefix = "https://wabac-cors-proxy.webrecorder.workers.dev/proxy/";

// [TODO]
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class WabacLiveProxy {
  constructor({ collName = "liveproxy", adblockUrl = undefined } = {}) {
    this.url = "";
    this.ts = "";
    this.collName = collName;
    this.matchRx = new RegExp(`${collName}\\/([\\d]+)?\\w\\w_\\/(.*)`);
    this.adblockUrl = adblockUrl;

    this.queryParams = { injectScripts: "./custom.js" };
  }

  async init() {
    window.addEventListener("load", () => {
      const iframe = document.querySelector("#content");
      if (iframe) {
        iframe.addEventListener("load", () =>
          this.onIframeLoad(iframe.contentWindow.location.href),
        );
      }
    });

    const scope = "./";

    // also add inject of custom.js as a script into each replayed page
    await navigator.serviceWorker.register(
      "./sw.js?" + new URLSearchParams(this.queryParams).toString(),
      { scope },
    );

    let initedResolve = null;

    const inited = new Promise((resolve) => (initedResolve = resolve));

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
      name: this.collName,
      type: "live",
      file: { sourceUrl: `proxy:${proxyPrefix}` },
      skipExisting: false,
      extraConfig: {
        prefix: proxyPrefix,
        isLive: false,
        baseUrl: baseUrl.href,
        baseUrlHashReplay: true,
        noPostToGet: true,
        archivePrefix: "https://web.archive.org/web/",
        adblockUrl: this.adblockUrl,
      },
    };

    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        navigator.serviceWorker.controller.postMessage(msg);
      });
    } else {
      navigator.serviceWorker.controller.postMessage(msg);
    }

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-condition
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

  onHashChange() {
    const m = window.location.hash.slice(1).match(/\/?(?:([\d]+)\/)?(.*)/);

    const url = m?.[2] || "https://example.com/";
    const ts = m?.[1] || "";

    // don't change if same url
    if (url === this.url && ts === this.ts) {
      return;
    }

    let iframeUrl = ts
      ? `/w/${this.collName}/${ts}mp_/${url}`
      : `/w/${this.collName}/mp_/${url}`;

    const iframe = document.querySelector("#content");
    iframe.src = iframeUrl;

    this.url = url;
    this.ts = ts;

    window.location.hash = ts ? `#${ts}/${url}` : `#${url}`;
  }

  onIframeLoad(url) {
    const m = url.match(this.matchRx);

    this.ts = m[1] || "";
    this.url = m[2] || "";

    window.location.hash = this.ts ? `#${this.ts}/${this.url}` : `#${this.url}`;
  }
}
