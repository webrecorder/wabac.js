import { BaseParser } from "./baseparser";


type HAR = Record<string, any>;

// ===========================================================================
class HARLoader extends BaseParser {
  har: HAR;
  pageRefs: Record<string, string>;

  constructor(string_or_har: string | HAR) {
    super();
    this.har = (typeof string_or_har === "string") ? JSON.parse(string_or_har) : string_or_har;
    this.pageRefs = {};
  }

  override async load(db: any) : Promise<void> {
    this.db = db;

    this.parseEntries(this.har);

    this.parsePages(this.har);

    await this.finishIndexing();
  }

  parsePages(har: HAR) {
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

  parseEntries(har: HAR) {
    for (const entry of har.log.entries) {
      const ts = new Date(entry.startedDateTime).getTime();

      const respHeaders : Record<string, string> = {};

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

