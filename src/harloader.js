
// ===========================================================================
class HARLoader {
  constructor(string_or_har) {
    this.har = string_or_har;
    this.pageRefs = {};
  }

  load(db) {
    this.db = db;
    if (typeof this.har === "string") {
      this.har = JSON.parse(this.har);
    }

    this.parseEntries(this.har);

    this.parsePages(this.har);

    return Promise.resolve(true);
  }

  parsePages(har) {
    for (const page of har.log.pages) {
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

      const date = page.startedDateTime;

      //this.pageList.push({ "timestamp": getTS(page.startedDateTime), "title": title, "url": url });
      this.db.addPage({url, date, title});
    }
  }

  parseEntries(har) {
    for (const entry of har.log.entries) {
      if (!entry.response.content || !entry.response.content.text) {
        continue;
      }

      let payload = null;

      try {
        payload = Uint8Array.from(atob(entry.response.content.text), c => c.charCodeAt(0));
      } catch (e) {
        payload = entry.response.content.text;
      }

      const ts = new Date(entry.startedDateTime).getTime();

      this.db.addResource({url: entry.request.url,
                           ts,
                           status: entry.response.status,
                           //statusText: entry.response.statusText,
                           respHeaders: entry.response.headers,
                           reqHeaders: entry.request.headers,
                           payload});

      if (entry.pageref && !this.pageRefs[entry.pageref]) {
        this.pageRefs[entry.pageref] = entry.request.url;
      }
    }
  }
}

export { HARLoader };

