import { getTS, makeNewResponse } from './utils.js';

class HARCache {
  constructor(string_or_har) {
    let har = string_or_har;

    if (typeof har === "string") {
      har = JSON.parse(har);
    }

    this.parseEntries(har);

    this.parsePages(har);
  }

  parsePages(har) {
    this.pageList = [];

    for (let page of har.log.pages) {
      if (!page.pageTimings || !page.pageTimings.onLoad) {
        continue;
      }

      let url;
      if (page.title && (page.title.startsWith("http:") || page.title.startsWith("https:"))) {
        url = page.title;
      } else {
        url = this.pageRefs[page.id];
      }

      const title = page.title || url;

      this.pageList.push({ "timestamp": getTS(page.startedDateTime), "title": title, "url": url });
    }
  }

  parseEntries(har) {
    this.urlMap = {};
    this.pageRefs = {};

    for (let entry of har.log.entries) {
      if (!entry.response.content || !entry.response.content.text) {
        continue;
      }
      this.urlMap[entry.request.url] = {
        "request": entry.request,
        "response": entry.response,
        "timestamp": getTS(entry.startedDateTime),
        "datetime": entry.startedDateTime,
      };

      if (entry.pageref && !this.pageRefs[entry.pageref]) {
        this.pageRefs[entry.pageref] = entry.request.url;
      }
    }
  }

  async match(request) {
    const entry = this.urlMap[request.url];
    if (!entry) {
      return null;
    }

    const headers = {}

    for (let header of entry.response.headers) {
      if (header.name.toLowerCase() === "content-encoding") {
        continue;
      }
      headers[header.name] = header.value;
    }

    const init = {
      "status": entry.response.status,
      "statusText": entry.response.statusText,
      "headers": headers
    }

    let content = null;


    try {
      //content = atob(entry.response.content.text);
      content = Uint8Array.from(atob(entry.response.content.text), c => c.charCodeAt(0));
    } catch (e) {
      content = entry.response.content.text;
    }

    return makeNewResponse(content, init,
      entry.timestamp,
      entry.datetime);
  }
}

export { HARCache };

