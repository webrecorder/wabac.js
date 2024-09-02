import { BaseParser } from "./baseparser.js";


// ===========================================================================
class HARLoader extends BaseParser {
  har: string | any;
  pageRefs: Record<string, string>;

  constructor(string_or_har) {
    super();
    this.har = string_or_har;
    this.pageRefs = {};
  }

  override async load(db) : Promise<void> {
    this.db = db;
    if (typeof this.har === "string") {
      this.har = JSON.parse(this.har);
    }

    this.parseEntries(this.har);

    this.parsePages(this.har);

    await this.finishIndexing();
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
      this.addPage({url, date, title});
    }
  }

  parseEntries(har) {
    for (const entry of har.log.entries) {
      const ts = new Date(entry.startedDateTime).getTime();

      const respHeaders = {};

      for (const {name, value} of entry.response.headers) {
        respHeaders[name] = value;
      }

      let payload : Uint8Array | null = null;

      const encoder = new TextEncoder();

      if (entry.response.content && entry.response.content.text) {
        try {
          payload = Uint8Array.from(atob(entry.response.content.text), c => c.charCodeAt(0));
        } catch (e) {
          payload = entry.response.content.text;
        }
      } else {
        const cl = respHeaders["Content-Length"];
        if (cl && cl !== "0") {
          console.log(`Warning: Content-Length ${cl} but no content found for ${entry.request.url}`);
          payload = encoder.encode("Sorry, the HAR file did not include the content for this resource.");
        } else {
          payload = Uint8Array.from([]);
        }
      }

      this.addResource({url: entry.request.url,
        ts,
        status: entry.response.status,
        //statusText: entry.response.statusText,
        respHeaders,
        //reqHeaders,
        payload});

      if (entry.pageref && !this.pageRefs[entry.pageref]) {
        this.pageRefs[entry.pageref] = entry.request.url;
      }
    }
  }
}

export { HARLoader };

