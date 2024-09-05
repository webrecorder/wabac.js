let self: ServiceWorkerGlobalScope;

type TimeRangeStat = {
  count: number;
  children: Set<string>;
  min?: number;
  max?: number;
};

class StatsTracker {
  timeRanges: Record<string, TimeRangeStat> = {};

  updateStats(date: Date, status: number, request: Request, event: FetchEvent) {
    const id = event.clientId || event.resultingClientId;

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!id || !date) {
      return;
    }

    if (!request.url || request.url.indexOf("mp_/") < 0) {
      return;
    }

    if (request.destination === "document" && status > 300 && status < 400) {
      return;
    }

    let timeRange: TimeRangeStat;

    if (this.timeRanges[id] === undefined) {
      timeRange = { count: 0, children: new Set<string>() };
      this.timeRanges[id] = timeRange;
      if (request.referrer.indexOf("mp_/") > 0) {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        self.clients
          .matchAll({ type: "window" })
          .then((clients) =>
            this.updateStatsParent(id, request.referrer, clients),
          );
      }
    } else {
      timeRange = this.timeRanges[id];
    }

    const timestamp = date.getTime();

    if (!timeRange.min || timestamp < timeRange.min) {
      timeRange.min = timestamp;
    }

    if (!timeRange.max || timestamp > timeRange.max) {
      timeRange.max = timestamp;
    }

    timeRange.count++;
  }

  updateStatsParent(
    id: string,
    referrer: string,
    clients: readonly WindowClient[],
  ) {
    for (const client of clients) {
      if (client.url === referrer) {
        //self.timeRanges[id].parent = client.id;
        if (!this.timeRanges[client.id]) {
          this.timeRanges[client.id] = {
            count: 0,
            children: new Set<string>(),
          };
        }
        // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
        this.timeRanges[client.id].children.add(id);
        break;
      }
    }
  }

  async getStats(event: FetchEvent) {
    //const client = await self.clients.get(fe.clientId);

    //const timeRange = self.timeRanges[client.url] || {};

    const reqUrl = new URL(event.request.url);

    const params = new URLSearchParams(reqUrl.search);

    let id = "";

    const url = params.get("url");

    const clients = await self.clients.matchAll({ type: "window" });

    const validIds: Record<string, number> = {};

    for (const client of clients) {
      if (client.url === url) {
        id = client.id;
      }
      validIds[client.id] = 1;
    }

    const srcRange = this.timeRanges[id] || {};

    const timeRange = {
      // @ts-expect-error [TODO] - TS2339 - Property 'count' does not exist on type '{}'.
      count: srcRange.count || 0,
      // @ts-expect-error [TODO] - TS2339 - Property 'min' does not exist on type '{}'.
      min: srcRange.min,
      // @ts-expect-error [TODO] - TS2339 - Property 'max' does not exist on type '{}'.
      max: srcRange.max,
    };

    // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    const children = this.timeRanges[id] && this.timeRanges[id].children;

    // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
    for (const child of children.values()) {
      const childRange = this.timeRanges[child];

      if (!childRange) {
        continue;
      }

      if (
        childRange.min &&
        (!timeRange.min || childRange.min < timeRange.min)
      ) {
        timeRange.min = childRange.min;
      }

      if (
        childRange.max &&
        (!timeRange.max || childRange.max > timeRange.max)
      ) {
        timeRange.max = childRange.max;
      }

      timeRange.count += childRange.count;
    }

    // remove invalid timeranges
    for (const id of Object.keys(this.timeRanges)) {
      if (!validIds[id]) {
        delete this.timeRanges[id];
      }
    }

    return new Response(JSON.stringify(timeRange), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

export { StatsTracker };
