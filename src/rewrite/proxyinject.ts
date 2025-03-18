type WbInfo = {
  prefix: string;
  proxyOrigin: string;
  localOrigin: string;
  proxyTLD?: string;
  localTLD?: string;
};

// Mini Wombat for proxy replay, includes:
// - window.open override for rewriting links to subdomain
// - dom override for rewriting A links to subdomains, IFRAME src to direct replay mode

class ProxyWombatRewrite {
  proxyOrigin: string;
  localOrigin: string;

  proxyTLD?: string;
  localTLD?: string;
  localScheme: string;

  prefix: string;
  relPrefix = "";
  schemeRelPrefix = "";

  constructor() {
    this.openOverride();
    this.domOverride();
    this.overrideInsertAdjacentHTML();

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

  recurseRewriteElem(curr: Element) {
    if (!curr.hasChildNodes()) return;
    const rewriteQ = [curr.childNodes];

    while (rewriteQ.length > 0) {
      const children = rewriteQ.shift();
      for (const child of children || []) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childElem = child as Element;
          this.rewriteElem(childElem);
          if (curr.hasChildNodes()) {
            rewriteQ.push(childElem.childNodes);
          }
        }
      }
    }
  }

  rewriteElem(curr: Element) {
    switch (curr.tagName) {
      case "IFRAME":
        {
          const src = curr.getAttribute("src");
          if (src) {
            curr.setAttribute("src", this.directRewriteUrl(src));
          }
        }
        break;

      case "A":
        {
          const href = curr.getAttribute("href");
          if (href) {
            curr.setAttribute("href", this.rewriteUrl(href));
          }
        }
        break;
    }
  }

  domOverride() {
    const rewriteFunc = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fnThis: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      originalFn: any,
      newNode: Node,
      oldNode?: Node,
    ) => {
      switch (newNode.nodeType) {
        case Node.ELEMENT_NODE:
          this.rewriteElem(newNode as Element);
          break;

        case Node.DOCUMENT_FRAGMENT_NODE:
          this.recurseRewriteElem(newNode as Element);
          break;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return originalFn.call(fnThis, newNode, oldNode);
    };

    const orig_appendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function (newNode: Node) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return rewriteFunc(this, orig_appendChild, newNode);
    };

    const orig_insertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (newNode: Node, refNode: Node) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return rewriteFunc(this, orig_insertBefore, newNode, refNode);
    };

    const orig_replaceChild = Node.prototype.replaceChild;
    Node.prototype.replaceChild = function (newNode: Node, oldNode: Node) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return rewriteFunc(this, orig_replaceChild, newNode, oldNode);
    };

    const orig_append = DocumentFragment.prototype.append;
    DocumentFragment.prototype.append = function (newNode: Node) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return rewriteFunc(this, orig_append, newNode);
    };

    const orig_prepend = DocumentFragment.prototype.prepend;
    DocumentFragment.prototype.prepend = function (newNode: Node) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return rewriteFunc(this, orig_prepend, newNode);
    };
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

  overrideInsertAdjacentHTML() {
    const orig = HTMLElement.prototype.insertAdjacentHTML;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rewriter = this;

    HTMLElement.prototype.insertAdjacentHTML = function (position, text) {
      text = rewriter.rewriteRxHtml(text);
      return orig.call(this, position, text);
    };
  }

  rewriteRxHtml(text: string) {
    return text.replace(
      /<\s*(a|iframe)\s+(?:src|href)[=]"(.*?)"/gi,
      (match: string, p1: string, p2: string) => {
        let rw = "";
        switch (p1) {
          case "a":
            rw = this.rewriteUrl(p2);
            break;

          case "iframe":
            rw = this.directRewriteUrl(p2);
            break;
        }
        if (rw && rw !== match) {
          return match.replace(p2, rw);
        }
        return match;
      },
    );
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

  directRewriteUrl(url: string, mod = "if_") {
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
      return this.prefix + mod + "/" + url;
    }

    if (url.startsWith("//") || url.startsWith("\\/\\/")) {
      return this.schemeRelPrefix + mod + "/" + url;
    }

    if (url.startsWith("/")) {
      url = new URL(url, document.baseURI).href;
      return this.relPrefix + mod + "/" + url;
    } else if (url.indexOf("../") >= 0) {
      url = new URL(url, document.baseURI).href;
      return this.prefix + mod + "/" + url;
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
