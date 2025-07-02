type WbInfo = {
  prefix: string;
  proxyOrigin: string;
  localOrigin: string;
  proxyTLD?: string;
  localTLD?: string;
  presetCookie?: string;
  seconds: string;
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
  proxyScheme: string;
  httpToHttpsNeeded: boolean;

  prefix: string;
  relPrefix = "";
  schemeRelPrefix = "";

  constructor() {
    this.openOverride();
    this.domOverride();
    this.overrideInsertAdjacentHTML();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wbinfo = (self as any).__wbinfo as WbInfo;

    this.initDateOverride(wbinfo.seconds);
    this.initAnchorElemOverride();

    this.overrideSWAccess();

    this.proxyOrigin = wbinfo.proxyOrigin;
    this.localOrigin = wbinfo.localOrigin;

    this.proxyTLD = wbinfo.proxyTLD;
    this.localTLD = wbinfo.localTLD;

    this.localScheme = new URL(this.localOrigin).protocol;
    this.proxyScheme = new URL(this.proxyOrigin).protocol;

    this.httpToHttpsNeeded =
      this.proxyScheme === "http:" && this.localScheme === "https:";

    this.prefix = wbinfo.prefix || "";
    if (this.prefix) {
      const parsed = new URL(this.prefix);
      this.relPrefix = parsed.pathname;
      this.schemeRelPrefix = this.prefix.slice(parsed.protocol.length);
    }

    if (wbinfo.presetCookie) {
      this.initPresetCookie(wbinfo.presetCookie);
    }
  }

  initPresetCookie(presetCookie: string) {
    const splitCookies = presetCookie.split(";");
    for (const cookie of splitCookies) {
      document.cookie = cookie.trim();
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
          const value = curr.getAttribute("src");
          if (value) {
            const newValue = this.fullRewriteUrl(value);
            if (value !== newValue) {
              curr.setAttribute("src", newValue);
            }
          }
        }
        break;

      case "A":
        {
          const value = curr.getAttribute("href");
          if (value) {
            const newValue = this.rewriteUrl(value);
            if (value !== newValue) {
              curr.setAttribute("href", newValue);
            }
          }
        }
        break;

      case "SCRIPT":
        if (this.httpToHttpsNeeded) {
          const value = curr.getAttribute("src");
          if (value) {
            const newValue = this.rewriteUrl(value);
            if (value !== newValue) {
              curr.setAttribute("src", newValue);
            }
          }
        }
        break;
    }
  }

  domOverride() {
    const rwNode = (node: Node) => {
      switch (node.nodeType) {
        case Node.ELEMENT_NODE:
          this.rewriteElem(node as Element);
          break;

        case Node.DOCUMENT_FRAGMENT_NODE:
          this.recurseRewriteElem(node as Element);
          break;
      }
    };

    const rewriteFunc = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fnThis: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      originalFn: any,
      newNode: Node,
      oldNode?: Node,
    ) => {
      rwNode(newNode);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return originalFn.call(fnThis, newNode, oldNode);
    };

    const rewriteArrayFunc = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fnThis: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      originalFn: any,
      newNodes: Node[],
    ) => {
      for (const node of newNodes) {
        rwNode(node);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return originalFn.call(fnThis, ...newNodes);
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
    DocumentFragment.prototype.append = function (...newNodes: Node[]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return rewriteArrayFunc(this, orig_append, newNodes);
    };

    const orig_prepend = DocumentFragment.prototype.prepend;
    DocumentFragment.prototype.prepend = function (...newNodes: Node[]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return rewriteArrayFunc(this, orig_prepend, newNodes);
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
      /<\s*(a|iframe)\s+(?:src|href)[=]['"](.*?)['"]/gi,
      (match: string, p1: string, p2: string) => {
        let rw = "";
        switch (p1) {
          case "a":
            rw = this.rewriteUrl(p2);
            break;

          case "iframe":
            rw = this.fullRewriteUrl(p2);
            break;
        }
        if (rw && rw !== match) {
          return match.replace(p2, rw);
        }
        return match;
      },
    );
  }

  convUrl(
    urlStr: string,
    fromOrigin: string,
    toOrigin: string,
    fromTLD?: string,
    toTLD?: string,
    fromSep?: string,
    toSep?: string,
    toScheme?: string,
    httpToHttpsNeeded = false,
  ) {
    if (fromOrigin && urlStr.startsWith(fromOrigin)) {
      return toOrigin + urlStr.slice(fromOrigin.length);
    }

    if (fromTLD && toTLD && urlStr.indexOf(fromTLD) > 0) {
      const url = new URL(urlStr);
      if (url.host.endsWith(fromTLD)) {
        let host = url.host.slice(0, -fromTLD.length);
        if (fromSep && toSep) {
          host = host.replace(fromSep, toSep);
        }
        const newUrl =
          toScheme + "//" + host + toTLD + url.href.slice(url.origin.length);
        return newUrl;
      }
    }

    if (httpToHttpsNeeded) {
      return urlStr.replace("http:", "https:");
    }

    return urlStr;
  }

  rewriteUrl(urlStr: string) {
    return this.convUrl(
      urlStr,
      this.proxyOrigin,
      this.localOrigin,
      this.proxyTLD,
      this.localTLD,
      ".",
      "-",
      this.localScheme,
      this.httpToHttpsNeeded,
    );
  }

  unrewriteUrl(urlStr: string): string {
    return this.convUrl(
      urlStr,
      this.localOrigin,
      this.proxyOrigin,
      this.localTLD,
      this.proxyTLD,
      "-",
      ".",
      this.proxyScheme,
    );
  }

  fullRewriteUrl(url: string, mod = "if_") {
    const origUrl = url;

    if (this.proxyOrigin && url.startsWith(this.proxyOrigin)) {
      return this.localOrigin + url.slice(this.proxyOrigin.length);
    }

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

    return origUrl;
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

  initAnchorElemOverride() {
    const origHref = Object.getOwnPropertyDescriptor(
      HTMLAnchorElement.prototype,
      "href",
    );
    if (!origHref?.get) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rw = this;

    const origHrefGet = origHref.get;

    const overrideProp = (
      propName: "href" | "hostname" | "host" | "protocol" | "origin",
    ) => {
      const origProp = Object.getOwnPropertyDescriptor(
        HTMLAnchorElement.prototype,
        propName,
      );
      if (!origProp?.set) {
        return;
      }

      const origPropSet = origProp.set;

      Object.defineProperty(HTMLAnchorElement.prototype, propName, {
        set(v: string) {
          const url = new URL(rw.rewriteUrl(v));
          return origPropSet.call(this, url[propName]);
        },
        get() {
          const url = new URL(
            rw.unrewriteUrl(origHrefGet.call(this) as string),
          );
          return url[propName];
        },
      });
    };

    overrideProp("href");
    overrideProp("hostname");
    overrideProp("host");
    overrideProp("protocol");
    overrideProp("origin");
  }

  initDateOverride(timestamp: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((self as any).__wb_Date_now) return;
    const newTimestamp = parseInt(timestamp) * 1000;
    // var timezone = new Date().getTimezoneOffset() * 60 * 1000;
    // Already UTC!
    const timezone = 0;
    const start_now = Date.now();
    const timediff = start_now - (newTimestamp - timezone);

    const orig_date = Date;

    const orig_utc = Date.UTC;
    const orig_parse = Date.parse;
    const orig_now = Date.now;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).__wb_Date_now = orig_now;

    // @ts-ignore old-style override
    window.Date = (function (Date_) {
      return function Date(
        A?: number,
        B?: number,
        C?: number,
        D?: number,
        E?: number,
        F?: number,
        G?: number,
      ) {
        // Apply doesn't work for constructors and Date doesn't
        // seem to like undefined args, so must explicitly
        // call constructor for each possible args 0..7
        if (A === undefined) {
          return new Date_(orig_now() - timediff);
        } else if (B === undefined) {
          return new Date_(A);
        } else if (C === undefined) {
          return new Date_(A, B);
        } else if (D === undefined) {
          return new Date_(A, B, C);
        } else if (E === undefined) {
          return new Date_(A, B, C, D);
        } else if (F === undefined) {
          return new Date_(A, B, C, D, E);
        } else if (G === undefined) {
          return new Date_(A, B, C, D, E, F);
        } else {
          return new Date_(A, B, C, D, E, F, G);
        }
      };
    })(Date);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Date as any).prototype = orig_date.prototype;

    Date.now = function now() {
      return orig_now() - timediff;
    };

    Date.UTC = orig_utc;
    Date.parse = orig_parse;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Date as any).__WB_timediff = timediff;

    Date.prototype.getTimezoneOffset = function () {
      return 0;
    };

    const orig_toString = Date.prototype.toString;
    Date.prototype.toString = function () {
      const string = orig_toString.call(this).split(" GMT")[0];
      return string + " GMT+0000 (GMT)";
    };

    const orig_toTimeString = Date.prototype.toTimeString;
    Date.prototype.toTimeString = function () {
      const string = orig_toTimeString.call(this).split(" GMT")[0];
      return string + " GMT+0000 (GMT)";
    };

    Object.defineProperty(Date.prototype, "constructor", {
      value: Date,
    });
  }

  overrideSWAccess() {
    const _WB_wombat_sw = window.navigator.serviceWorker;

    const overrideSW = {
      controller: null,
      ready: Promise.resolve({ unregister: function () {} }),
      register: async () => Promise.reject(),
      addEventListener: function () {},
      removeEventListener: function () {},
      onmessage: null,
      oncontrollerchange: null,
      getRegistrations: async () => Promise.resolve([]),
      getRegistration: async () => Promise.resolve(undefined),
      startMessages: function () {},
    };

    Object.defineProperty(window.navigator, "serviceWorker", {
      get: () => overrideSW,
    });
  }
}

new ProxyWombatRewrite();
