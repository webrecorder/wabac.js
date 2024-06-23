type TimeRangeStat = {
    count: number;
    children: Set<string>;
    min?: number;
    max?: number;
};
declare class StatsTracker {
    timeRanges: Record<string, TimeRangeStat>;
    updateStats(date: any, status: any, request: any, event: FetchEvent): void;
    updateStatsParent(id: any, referrer: any, clients: any): void;
    getStats(event: any): Promise<Response>;
}
export { StatsTracker };
//# sourceMappingURL=statstracker.d.ts.map