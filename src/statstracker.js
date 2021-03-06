class StatsTracker {
  constructor() {
    this.timeRanges = {};
  }

  updateStats(date, status, request, event) {
    const id = event.clientId || event.resultingClientId;
    
    if (!id || !date) {
      return;
    }

    if (!request.url || request.url.indexOf("mp_/") < 0) {
      return;
    }

    if (request.destination === "document" && (status > 300 && status < 400)) {
      return;
    }

    let timeRange = null;

    if (this.timeRanges[id] === undefined) {
      timeRange = { "count": 0, "children": [] };
      this.timeRanges[id] = timeRange;
      if (request.referrer.indexOf("mp_/") > 0) {
        self.clients.matchAll({ "type": "window" }).then(clients => this.updateStatsParent(id, request.referrer, clients));
      }
    } else {
      timeRange = this.timeRanges[id];
    }

    const timestamp = date.getTime();

    if (!timeRange.min || (timestamp < timeRange.min)) {
      timeRange.min = timestamp;
    }

    if (!timeRange.max || (timestamp > timeRange.max)) {
      timeRange.max = timestamp;
    }

    timeRange.count++;
  }

  updateStatsParent(id, referrer, clients) {
    for (let client of clients) {
      if (client.url === referrer) {
        //self.timeRanges[id].parent = client.id;
        if (!this.timeRanges[client.id]) {
          this.timeRanges[client.id] = { "count": 0, "children": { id: 1 } };
        } else {
          this.timeRanges[client.id].children[id] = 1;
        }
        break;
      }
    }
  }

  async getStats(event) {
    //const client = await self.clients.get(fe.clientId);

    //const timeRange = self.timeRanges[client.url] || {};

    const reqUrl = new URL(event.request.url);

    const params = new URLSearchParams(reqUrl.search);

    let id = 0;

    const url = params.get("url");

    const clients = await self.clients.matchAll({ "type": "window" });

    const validIds = {};

    for (let client of clients) {
      if (client.url === url) {
        id = client.id;
      }
      validIds[client.id] = 1;
    }

    const srcRange = this.timeRanges[id] || {};

    const timeRange = {
      "count": srcRange.count || 0,
      "min": srcRange.min,
      "max": srcRange.max
    };

    const children = (this.timeRanges[id] && Object.keys(this.timeRanges[id].children)) || [];

    for (let child of children) {
      const childRange = this.timeRanges[child];

      if (!childRange) {
        continue;
      }


      if (!timeRange.min || (childRange.min < timeRange.min)) {
        timeRange.min = childRange.min;
      }

      if (!timeRange.max || (childRange.max > timeRange.max)) {
        timeRange.max = childRange.max;
      }

      timeRange.count += childRange.count;
    }

    // remove invalid timeranges
    for (let id of Object.keys(this.timeRanges)) {
      if (!validIds[id]) {
        delete this.timeRanges[id];
      }
    }

    return new Response(JSON.stringify(timeRange), { "headers": { "Content-Type": "application/json" } });
  }
}

export { StatsTracker };
