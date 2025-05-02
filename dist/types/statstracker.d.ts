type TimeRangeStat = {
    count: number;
    children: Set<string>;
    min?: number;
    max?: number;
};
declare class StatsTracker {
    timeRanges: Record<string, TimeRangeStat>;
    updateStats(date: Date, status: number, request: Request, event: FetchEvent): void;
    updateStatsParent(id: string, referrer: string, clients: readonly WindowClient[]): void;
    getStats(event: FetchEvent): Promise<Response>;
}
export { StatsTracker };
//# sourceMappingURL=statstracker.d.ts.map