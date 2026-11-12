import type { RideSummary, TrackPoint } from "./ride.ts";
import { cells } from "./insights.ts";

/** One route for the heatmap: its GPS points, thinned, and the year it was ridden. */
export type HeatRoute = { id: string; start: number; points: [number, number][] };

/** Points per route on the heatmap: plenty for a line, light enough to send a few hundred. */
const HEAT_POINTS = 300;

/** A route's GPS line thinned for the heatmap, as lat, lng, lat, lng… (5 decimals, about a metre). */
export function routeLine(track: TrackPoint[]): number[] {
  const gps = track.filter((p) => p.lat !== null && p.lng !== null);
  const step = Math.max(1, Math.ceil(gps.length / HEAT_POINTS));
  return gps.filter((_, i) => i % step === 0 || i === gps.length - 1).flatMap((p) => [Math.round(p.lat! * 1e5) / 1e5, Math.round(p.lng! * 1e5) / 1e5]);
}

/**
 * What's kept of a route for the pages that look across every ride: the
 * squares it passes through (to find rides on the same roads) and a thinned
 * line (for the heatmap). A few kB, against a couple of hundred for the route.
 */
export type Shape = { cells: string[]; line: number[] };

export const shapeOf = (track: TrackPoint[]): Shape => ({ cells: [...cells(track)], line: routeLine(track) });

/** A stored shape, or null if it isn't one. */
export function readShape(v: unknown): Shape | null {
  const o = v as { cells?: unknown; line?: unknown } | undefined;
  if (!o || !Array.isArray(o.cells) || !Array.isArray(o.line)) return null;
  return { cells: o.cells.filter((c): c is string => typeof c === "string"), line: o.line.filter((x): x is number => typeof x === "number") };
}

const pairs = (line: number[]) => Array.from({ length: Math.floor(line.length / 2) }, (_, i) => [line[2 * i], line[2 * i + 1]] as [number, number]);

/** Heatmap routes from stored shapes. */
export function heatFromShapes(rides: RideSummary[], shapes: Record<string, Shape>): HeatRoute[] {
  return rides.map((r) => ({ id: r.id, start: r.start, points: pairs(shapes[r.id]?.line ?? []) })).filter((r) => r.points.length > 1);
}

/** Heatmap routes straight from full routes (the demo). */
export function heatRoutes(rides: RideSummary[], tracks: Record<string, TrackPoint[]>): HeatRoute[] {
  return heatFromShapes(rides, Object.fromEntries(rides.map((r) => [r.id, shapeOf(tracks[r.id] ?? [])])));
}
