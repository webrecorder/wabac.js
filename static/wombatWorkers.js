/*
Copyright(c) 2013-2018 Rhizome and Contributors. Released under the GNU General Public License.

This file is part of pywb, https://github.com/webrecorder/pywb

pywb is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

pywb is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with pywb.  If not, see <http://www.gnu.org/licenses/>.
 */
function WBWombat(info) {
  return this instanceof WBWombat
    ? void ((this.info = info),
      this.initImportScriptsRewrite(),
      this.initHTTPOverrides(),
      this.initClientApisOverride(),
      this.initCacheApisOverride())
    : new WBWombat(info);
}
(WBWombat.prototype.noRewrite = function (url) {
  return (
    !url ||
    url.indexOf("blob:") === 0 ||
    url.indexOf("javascript:") === 0 ||
    url.indexOf("data:") === 0 ||
    url.indexOf(this.info.prefix) === 0
  );
}),
  (WBWombat.prototype.isRelURL = function (url) {
    return url.indexOf("/") === 0 || url.indexOf("http:") !== 0;
  }),
  (WBWombat.prototype.maybeResolveURL = function (maybeRelURL, against) {
    if (!against) return maybeRelURL;
    try {
      var resolved = new URL(maybeRelURL, against);
      return resolved.href;
    } catch (e) {}
    return maybeRelURL;
  }),
  (WBWombat.prototype.ensureURL = function (url, resolveAgainst) {
    if (!url) return url;
    var newURL;
    switch (typeof url) {
      case "string":
        newURL = url;
        break;
      case "object":
        newURL = url.toString();
        break;
      default:
        return null;
    }
    return this.noRewrite(newURL)
      ? null
      : this.isRelURL(newURL)
        ? this.maybeResolveURL(newURL, resolveAgainst)
        : newURL.indexOf(self.location.origin) === 0
          ? this.maybeResolveURL(
              newURL.slice(self.location.origin.length),
              resolveAgainst,
            )
          : newURL;
  }),
  (WBWombat.prototype.rewriteURL = function (url) {
    var rwURL = this.ensureURL(url, this.info.originalURL);
    return rwURL
      ? this.info.prefixMod
        ? this.info.prefixMod + rwURL
        : rwURL
      : url;
  }),
  (WBWombat.prototype.rewriteClientWindowURL = function (url, client) {
    var rwURL = this.ensureURL(
      url,
      client ? client.url : this.info.originalURL,
    );
    return rwURL
      ? this.info.prefix
        ? this.info.prefix + "mp_/" + rwURL
        : rwURL
      : url;
  }),
  (WBWombat.prototype.rewriteWSURL = function (originalURL) {
    if (!originalURL) return originalURL;
    var urltype_ = typeof originalURL,
      url = originalURL;
    if (urltype_ === "object") url = originalURL.toString();
    else if (urltype_ !== "string") return originalURL;
    if (!url) return url;
    var wsScheme = "ws://",
      wssScheme = "wss://",
      https = "https://",
      wbSecure = this.info.prefix.indexOf(https) === 0,
      wbPrefix =
        this.info.prefix.replace(
          wbSecure ? https : "http://",
          wbSecure ? wssScheme : "ws://",
        ) + "ws_/";
    return wbPrefix + url;
  }),
  (WBWombat.prototype.rewriteArgs = function (argsObj) {
    for (
      var newArgObj = new Array(argsObj.length), i = 0;
      i < newArgObj.length;
      i++
    )
      newArgObj[i] = this.rewriteURL(argsObj[i]);
    return newArgObj;
  }),
  (WBWombat.prototype.rewriteFetchApi = function (input) {
    var rwInput = input;
    switch (typeof input) {
      case "string":
        rwInput = this.rewriteURL(input);
        break;
      case "object":
        if (input.url) {
          var new_url = this.rewriteURL(input.url);
          new_url !== input.url && (rwInput = new Request(new_url, input));
        } else input.href && (rwInput = input.href);
    }
    return rwInput;
  }),
  (WBWombat.prototype.rewriteCacheApi = function (request) {
    var rwRequest = request;
    return (
      typeof request === "string" && (rwRequest = this.rewriteURL(request)),
      rwRequest
    );
  }),
  (WBWombat.prototype.initImportScriptsRewrite = function () {
    if (self.importScripts) {
      var wombat = this,
        origImportScripts = self.importScripts;
      self.importScripts = function importScripts() {
        var rwArgs = wombat.rewriteArgs(arguments);
        return origImportScripts.apply(this, rwArgs);
      };
    }
  }),
  (WBWombat.prototype.initHTTPOverrides = function () {
    var wombat = this;
    if (
      self.XMLHttpRequest &&
      self.XMLHttpRequest.prototype &&
      self.XMLHttpRequest.prototype.open
    ) {
      var oXHROpen = self.XMLHttpRequest.prototype.open;
      self.XMLHttpRequest.prototype.open = function open(
        method,
        url,
        async,
        user,
        password,
      ) {
        var rwURL = wombat.rewriteURL(url),
          openAsync = true;
        async == null || async || (openAsync = false),
          oXHROpen.call(this, method, rwURL, openAsync, user, password),
          rwURL.indexOf("data:") === -1 &&
            this.setRequestHeader("X-Pywb-Requested-With", "XMLHttpRequest");
      };
    }
    if (self.fetch != null) {
      var orig_fetch = self.fetch;
      self.fetch = function fetch(input, init_opts) {
        var rwInput = wombat.rewriteFetchApi(input),
          newInitOpts = init_opts || {};
        return (
          (newInitOpts.credentials = "include"),
          orig_fetch.call(this, rwInput, newInitOpts)
        );
      };
    }
    if (self.Request && self.Request.prototype) {
      var orig_request = self.Request;
      (self.Request = (function (Request_) {
        return function Request(input, init_opts) {
          var newInitOpts = init_opts || {},
            newInput = wombat.rewriteFetchApi(input);
          return (
            (newInitOpts.credentials = "include"),
            new Request_(newInput, newInitOpts)
          );
        };
      })(self.Request)),
        (self.Request.prototype = orig_request.prototype);
    }
    if (self.Response && self.Response.prototype) {
      var originalRedirect = self.Response.prototype.redirect;
      self.Response.prototype.redirect = function redirect(url, status) {
        var rwURL = wombat.rewriteUrl(url);
        return originalRedirect.call(this, rwURL, status);
      };
    }
    if (self.EventSource && self.EventSource.prototype) {
      var origEventSource = self.EventSource;
      (self.EventSource = (function (EventSource_) {
        return function EventSource(url, configuration) {
          var rwURL = url;
          return (
            url != null && (rwURL = wombat.rewriteUrl(url)),
            new EventSource_(rwURL, configuration)
          );
        };
      })(self.EventSource)),
        (self.EventSource.prototype = origEventSource.prototype),
        Object.defineProperty(self.EventSource.prototype, "constructor", {
          value: self.EventSource,
        });
    }
    if (self.WebSocket && self.WebSocket.prototype) {
      var origWebSocket = self.WebSocket;
      (self.WebSocket = (function (WebSocket_) {
        return function WebSocket(url, configuration) {
          var rwURL = url;
          return (
            url != null && (rwURL = wombat.rewriteWSURL(url)),
            new WebSocket_(rwURL, configuration)
          );
        };
      })(self.WebSocket)),
        (self.WebSocket.prototype = origWebSocket.prototype),
        Object.defineProperty(self.WebSocket.prototype, "constructor", {
          value: self.WebSocket,
        });
    }
  }),
  (WBWombat.prototype.initClientApisOverride = function () {
    var wombat = this;
    if (
      self.Clients &&
      self.Clients.prototype &&
      self.Clients.prototype.openWindow
    ) {
      var oClientsOpenWindow = self.Clients.prototype.openWindow;
      self.Clients.prototype.openWindow = function openWindow(url) {
        var rwURL = wombat.rewriteClientWindowURL(url);
        return oClientsOpenWindow.call(this, rwURL);
      };
    }
    if (
      self.WindowClient &&
      self.WindowClient.prototype &&
      self.WindowClient.prototype.navigate
    ) {
      var oWinClientNavigate = self.WindowClient.prototype.navigate;
      self.WindowClient.prototype.navigate = function navigate(url) {
        var rwURL = wombat.rewriteClientWindowURL(url, this);
        return oWinClientNavigate.call(this, rwURL);
      };
    }
  }),
  (WBWombat.prototype.initCacheApisOverride = function () {
    var wombat = this;
    if (
      self.CacheStorage &&
      self.CacheStorage.prototype &&
      self.CacheStorage.prototype.match
    ) {
      var oCacheStorageMatch = self.CacheStorage.prototype.match;
      self.CacheStorage.prototype.match = function match(request, options) {
        var rwRequest = wombat.rewriteCacheApi(request);
        return oCacheStorageMatch.call(this, rwRequest, options);
      };
    }
    if (self.Cache && self.Cache.prototype) {
      if (self.Cache.prototype.match) {
        var oCacheMatch = self.Cache.prototype.match;
        self.Cache.prototype.match = function match(request, options) {
          var rwRequest = wombat.rewriteCacheApi(request);
          return oCacheMatch.call(this, rwRequest, options);
        };
      }
      if (self.Cache.prototype.matchAll) {
        var oCacheMatchAll = self.Cache.prototype.matchAll;
        self.Cache.prototype.matchAll = function matchAll(request, options) {
          var rwRequest = wombat.rewriteCacheApi(request);
          return oCacheMatchAll.call(this, rwRequest, options);
        };
      }
      if (self.Cache.prototype.add) {
        var oCacheAdd = self.Cache.prototype.add;
        self.Cache.prototype.add = function add(request, options) {
          var rwRequest = wombat.rewriteCacheApi(request);
          return oCacheAdd.call(this, rwRequest, options);
        };
      }
      if (self.Cache.prototype.addAll) {
        var oCacheAddAll = self.Cache.prototype.addAll;
        self.Cache.prototype.addAll = function addAll(requests) {
          var rwRequests = requests;
          if (Array.isArray(requests)) {
            rwRequests = new Array(requests.length);
            for (var i = 0; i < requests.length; i++)
              rwRequests[i] = wombat.rewriteCacheApi(requests[i]);
          }
          return oCacheAddAll.call(this, rwRequests);
        };
      }
      if (self.Cache.prototype.put) {
        var oCachePut = self.Cache.prototype.put;
        self.Cache.prototype.put = function put(request, response) {
          var rwRequest = wombat.rewriteCacheApi(request);
          return oCachePut.call(this, rwRequest, response);
        };
      }
      if (self.Cache.prototype.delete) {
        var oCacheDelete = self.Cache.prototype.delete;
        self.Cache.prototype.delete = function newCacheDelete(
          request,
          options,
        ) {
          var rwRequest = wombat.rewriteCacheApi(request);
          return oCacheDelete.call(this, rwRequest, options);
        };
      }
      if (self.Cache.prototype.keys) {
        var oCacheKeys = self.Cache.prototype.keys;
        self.Cache.prototype.keys = function keys(request, options) {
          var rwRequest = wombat.rewriteCacheApi(request);
          return oCacheKeys.call(this, rwRequest, options);
        };
      }
    }
  }),
  (self.WBWombat = WBWombat);
