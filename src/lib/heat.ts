import type { RideSummary, TrackPoint } from "./ride.ts";

/** One route for the heatmap: its GPS points, thinned, and the year it was ridden. */
export type HeatRoute = { id: string; start: number; points: [number, number][] };

/** Points per route on the heatmap: plenty for a line, light enough to send a few hundred. */
const HEAT_POINTS = 300;

export function heatRoutes(rides: RideSummary[], tracks: Record<string, TrackPoint[]>): HeatRoute[] {
  return rides
    .map((r) => {
      const gps = (tracks[r.id] ?? []).filter((p) => p.lat !== null && p.lng !== null);
      const step = Math.max(1, Math.ceil(gps.length / HEAT_POINTS));
      const points = gps.filter((_, i) => i % step === 0 || i === gps.length - 1).map((p) => [Math.round(p.lat! * 1e5) / 1e5, Math.round(p.lng! * 1e5) / 1e5] as [number, number]);
      return { id: r.id, start: r.start, points };
    })
    .filter((r) => r.points.length > 1);
}
