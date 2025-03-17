type WbInfo = {
  prefix: string;
  proxyOrigin: string;
  localOrigin: string;
  proxyTLD?: string;
  localTLD?: string;
};

// Mini Wombat for proxy, includes:
// - Mutation Observer for a.href and iframe.src rewriting (direct rewrite)
// - window.open override

class ProxyWombatRewrite {
  mutationObserver: MutationObserver;

  proxyOrigin: string;
  localOrigin: string;

  proxyTLD?: string;
  localTLD?: string;
  localScheme: string;

  prefix: string;
  relPrefix = "";
  schemeRelPrefix = "";

  constructor() {
    this.mutationObserver = new MutationObserver((changes) =>
      this.observeChange(changes),
    );

    this.mutationObserver.observe(document.documentElement, {
      characterData: false,
      characterDataOldValue: false,
      attributes: true,
      attributeOldValue: false,
      subtree: true,
      childList: true,
      attributeFilter: ["href", "src"],
    });

    this.openOverride();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wbinfo = (self as any).__wbinfo as WbInfo;

    this.proxyOrigin = wbinfo.proxyOrigin;
    this.localOrigin = wbinfo.localOrigin;

    this.proxyTLD = wbinfo.proxyTLD;
    this.localTLD = wbinfo.localTLD;

    this.localScheme = new URL(this.localOrigin).protocol;

    this.prefix = wbinfo.prefix || "";
    if (this.prefix) {
      const parsed = new URL(this.prefix);
      this.relPrefix = parsed.pathname;
      this.schemeRelPrefix = this.prefix.slice(parsed.protocol.length);
    }
  }

  observeChange(changes: MutationRecord[]) {
    for (const change of changes) {
      this.processChangedNode(change.target);

      if (change.type === "childList") {
        for (const node of change.addedNodes) {
          this.processChangedNode(node);
        }
      }
    }
  }

  processChangedNode(target: Node) {
    switch (target.nodeType) {
      case Node.ATTRIBUTE_NODE:
        // rewrite A hrefs with prefix
        if (
          target.nodeName === "href" &&
          target.parentElement?.tagName === "A"
        ) {
          const url = target.nodeValue;
          if (url) {
            console.log("rewriting " + url);
            target.parentElement.setAttribute(
              target.nodeName,
              this.rewriteUrl(url),
            );
          }
        }
        // rewrite IFRAME src with direct replay URL
        if (
          target.nodeName === "src" &&
          target.parentElement?.tagName === "IFRAME"
        ) {
          const url = target.nodeValue;
          if (url) {
            console.log("rewriting " + url);
            target.parentElement.setAttribute(
              target.nodeName,
              this.directRewriteUrl(url),
            );
          }
        }
        break;
    }
  }

  openOverride() {
    let orig = window.open;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (Window.prototype.open) {
      orig = Window.prototype.open;
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rewriter = this;

    function openRW(
      strUrl: string | URL | undefined,
      strWindowName?: string,
      strWindowFeatures?: string,
    ): Window | null {
      const rwStrUrl = strUrl ? rewriter.rewriteUrl(strUrl.toString()) : "";
      const res = orig.call(
        // @ts-ignore
        this,
        rwStrUrl,
        strWindowName,
        strWindowFeatures,
      );
      return res;
    }

    window.open = openRW;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (Window.prototype.open) {
      Window.prototype.open = openRW;
    }

    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let i = 0; i < window.frames.length; i++) {
      try {
        window.frames[i]!.open = openRW;
      } catch (e) {
        console.log(e);
      }
    }
  }

  rewriteUrl(urlStr: string) {
    if (this.proxyOrigin && urlStr.startsWith(this.proxyOrigin)) {
      return this.localOrigin + urlStr.slice(this.proxyOrigin.length);
    }

    if (this.proxyTLD && this.localTLD && urlStr.indexOf(this.proxyTLD) > 0) {
      const url = new URL(urlStr);
      if (url.host.endsWith(this.proxyTLD)) {
        const host =
          url.host.slice(0, -this.proxyTLD.length).replace(".", "-") +
          this.localTLD;
        const newUrl =
          this.localScheme + "//" + host + url.href.slice(url.origin.length);
        return newUrl;
      }
    }

    return urlStr;
  }

  directRewriteUrl(url: string) {
    const origUrl = url;

    url = url.trim();

    if (
      !url ||
      !this.isRewritableUrl(url) ||
      url.startsWith(this.prefix) ||
      url.startsWith(this.relPrefix)
    ) {
      return origUrl;
    }

    if (
      url.startsWith("http:") ||
      url.startsWith("https:") ||
      url.startsWith("https\\3a/")
    ) {
      return this.prefix + url;
    }

    if (url.startsWith("//") || url.startsWith("\\/\\/")) {
      return this.schemeRelPrefix + url;
    }

    if (url.startsWith("/")) {
      url = new URL(url, document.baseURI).href;
      return this.relPrefix + url;
    } else if (url.indexOf("../") >= 0) {
      url = new URL(url, document.baseURI).href;
      return this.prefix + url;
    } else {
      return origUrl;
    }
  }

  isRewritableUrl(url: string) {
    const NO_REWRITE_URI_PREFIX = [
      "#",
      "javascript:",
      "data:",
      "mailto:",
      "about:",
      "file:",
      "blob:",
      "{",
    ];

    for (const prefix of NO_REWRITE_URI_PREFIX) {
      if (url.startsWith(prefix)) {
        return false;
      }
    }

    return true;
  }
}

new ProxyWombatRewrite();
