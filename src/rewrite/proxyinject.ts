type WbInfo = {
  proxyOrigin: string;
  localOrigin: string;
  proxyTLD?: string;
  localTLD?: string;
};

// Mini Wombat for proxy -- Mutation Observer + window.open override

class ProxyWombatRewrite {
  mutationObserver: MutationObserver;

  proxyOrigin: string;
  localOrigin: string;

  proxyTLD?: string;
  localTLD?: string;
  localScheme: string;

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
      attributeFilter: ["href"],
    });

    this.openOverride();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wbinfo = (self as any).__wbinfo as WbInfo;

    this.proxyOrigin = wbinfo.proxyOrigin;
    this.localOrigin = wbinfo.localOrigin;

    this.proxyTLD = wbinfo.proxyTLD;
    this.localTLD = wbinfo.localTLD;

    this.localScheme = new URL(this.localOrigin).protocol;
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
        if (
          target.nodeName === "href" &&
          target.parentElement?.tagName === "A"
        ) {
          const url = target.nodeValue;
          if (url) {
            console.log("rewriting " + url);
            target.parentElement?.setAttribute(
              target.nodeName,
              this.rewriteUrl(url),
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
}

new ProxyWombatRewrite();
