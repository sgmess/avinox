import type { RideSummary, TrackPoint } from "./ride.ts";
import type { Settings } from "./settings.ts";
import { batteryDrop, median, packWh } from "./stats.ts";

/* ---------- Climbing efficiency ---------- */

/** Rides needed before fitting what flat distance and climbing each cost. */
export const MIN_FIT_RIDES = 8;

export type ClimbModel = {
  /** Pack Wh per km on the flat. */
  flatWhPerKm: number;
  /** Pack Wh per metre climbed, on top of the distance. */
  whPerM: number;
  rides: number;
};

/** The rides worth fitting: long enough that a 1% battery step isn't most of the reading. */
const fitRides = (rides: RideSummary[]) => rides.filter((r) => r.km >= 3 && (r.batteryStart === null || batteryDrop(r) >= 5 || r.motorWh > 0));

/**
 * Splits each ride's battery use into a cost per km and a cost per metre
 * climbed, by least squares across rides: Wh ≈ a·km + b·climb. Needs rides
 * with different amounts of climbing, or the two can't be told apart.
 */
export function climbModel(rides: RideSummary[], s: Settings, efficiency: number): ClimbModel | null {
  const pts = fitRides(rides).map((r) => ({ km: r.km, m: r.ascentM, wh: packWh(r, s, efficiency) })).filter((p) => p.wh > 0);
  if (pts.length < MIN_FIT_RIDES) return null;
  const rates = pts.map((p) => p.m / p.km);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const spread = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length);
  if (spread < 3) return null;
  let kk = 0, km = 0, mm = 0, wk = 0, wm = 0;
  for (const p of pts) {
    kk += p.km * p.km;
    km += p.km * p.m;
    mm += p.m * p.m;
    wk += p.wh * p.km;
    wm += p.wh * p.m;
  }
  const det = kk * mm - km * km;
  if (!det) return null;
  const a = (wk * mm - wm * km) / det;
  const b = (kk * wm - km * wk) / det;
  return a > 0 && b > 0 ? { flatWhPerKm: a, whPerM: b, rides: pts.length } : null;
}

/** Climbing per km that marks each band, metres. */
export const HILL_BANDS = [
  { key: "flat", lo: 0, hi: 10 },
  { key: "rolling", lo: 10, hi: 20 },
  { key: "hilly", lo: 20, hi: 35 },
  { key: "steep", lo: 35, hi: Infinity },
] as const;

/** Battery per km on flat, rolling, hilly and steep rides. */
export function hillBands(rides: RideSummary[], s: Settings, efficiency: number) {
  const pts = fitRides(rides).map((r) => ({ rate: r.ascentM / r.km, whPerKm: packWh(r, s, efficiency) / r.km })).filter((p) => p.whPerKm > 0);
  return HILL_BANDS.map((b) => {
    const inBand = pts.filter((p) => p.rate >= b.lo && p.rate < b.hi);
    return { ...b, rides: inBand.length, whPerKm: median(inBand.map((p) => p.whPerKm)), climbPerKm: median(inBand.map((p) => p.rate)) };
  });
}

/* ---------- Range planner ---------- */

export type PlanMode = { value: string; name: string; color: string; whPerKm: number | null; seconds: number };

/**
 * Battery % a ride of `km` with `climbM` of climbing would take in each mode.
 * The climb model prices the route at your usual mix of modes; each mode then
 * scales it by how its cost per km compares with your average.
 */
export function planRide(
  route: { km: number; climbM: number },
  modes: PlanMode[],
  averageWhPerKm: number | null,
  model: ClimbModel | null,
  usableWh: number,
  coldExtra: number | null,
) {
  if (!averageWhPerKm || route.km <= 0) return [];
  const routeWh = model ? model.flatWhPerKm * route.km + model.whPerM * route.climbM : averageWhPerKm * route.km;
  return modes
    .filter((m) => m.whPerKm && Number(m.value) !== 0 && m.seconds >= 600)
    .map((m) => {
      const wh = (m.whPerKm! / averageWhPerKm) * routeWh;
      return {
        ...m,
        wh,
        pct: (wh / usableWh) * 100,
        coldPct: coldExtra && coldExtra > 0 ? (wh * (1 + coldExtra) * 100) / usableWh : null,
      };
    });
}

/* ---------- Comparing rides ---------- */

const hasGps = (p: TrackPoint): p is TrackPoint & { lat: number; lng: number } => p.lat !== null && p.lng !== null;

/** Grid squares about 200 m across that a route passes through. */
export function cells(track: TrackPoint[]) {
  const out = new Set<string>();
  for (const p of track) if (hasGps(p)) out.add(`${Math.round(p.lat / 0.0018)}:${Math.round((p.lng * Math.cos((p.lat * Math.PI) / 180)) / 0.0018)}`);
  return out;
}

/** Share of two routes' squares they have in common (0–1). */
export function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const c of a) if (b.has(c)) both++;
  return both / (a.size + b.size - both);
}

/** Rides that mostly follow the same roads and trails and are about as long. */
export function similarRides(ride: RideSummary, track: TrackPoint[], others: { ride: RideSummary; track: TrackPoint[] }[], minOverlap = 0.45) {
  const mine = cells(track);
  if (!mine.size) return [];
  return others
    .filter((o) => o.ride.id !== ride.id && Math.abs(o.ride.km - ride.km) <= Math.max(1, ride.km * 0.25))
    .map((o) => ({ ...o, overlap: overlap(mine, cells(o.track)) }))
    .filter((o) => o.overlap >= minOverlap)
    .sort((a, b) => b.overlap - a.overlap);
}

/** Metres between two points (fine for a few km). */
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dy = (a.lat - b.lat) * 111_195;
  const dx = (a.lng - b.lng) * 111_195 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

export type Climb = { from: number; to: number; km: number; gainM: number; gradePct: number };

/**
 * The climbs on a route: rises of at least `minGain` metres averaging 3% or
 * more, ended by a drop of 10 m from the top. Biggest first.
 */
export function findClimbs(track: TrackPoint[], minGain = 40): Climb[] {
  const pts = track.map((p, i) => ({ i, km: p.km, alt: p.alt })).filter((p): p is { i: number; km: number; alt: number } => p.alt !== null);
  const out: Climb[] = [];
  let low = 0;
  let high = 0;
  const close = () => {
    // Start where the rise does, not at the far end of a flat run-in.
    let from = low;
    while (from + 1 < high && pts[from + 1].alt <= pts[low].alt + 1) from++;
    const a = pts[from];
    const b = pts[high];
    const gain = b.alt - a.alt;
    const km = b.km - a.km;
    if (gain >= minGain && km > 0 && gain / (km * 1000) >= 0.03) out.push({ from: a.i, to: b.i, km, gainM: gain, gradePct: (gain / (km * 1000)) * 100 });
  };
  for (let j = 1; j < pts.length; j++) {
    if (pts[j].alt > pts[high].alt) high = j;
    if (pts[j].alt < pts[low].alt && high <= low) {
      low = j;
      high = j;
    } else if (pts[high].alt - pts[j].alt >= 10) {
      close();
      low = j;
      high = j;
    }
  }
  close();
  return out.sort((a, b) => b.gainM - a.gainM);
}

export type Effort = {
  seconds: number;
  km: number;
  gainM: number;
  riderWh: number;
  motorWh: number;
  /** Battery % at the start minus at the end, when both were read. */
  batteryPct: number | null;
  /** Share of the time in each assist value. */
  modes: Record<string, number>;
};

/** What a stretch of a route took: time, both riders' energy, battery and assist. */
export function effort(track: TrackPoint[], from: number, to: number): Effort {
  let riderWh = 0;
  let motorWh = 0;
  const modeS: Record<string, number> = {};
  for (let i = from; i < to; i++) {
    const dt = Math.max(0, track[i + 1].s - track[i].s);
    riderWh += (track[i].riderW * dt) / 3600;
    motorWh += (track[i].motorW * dt) / 3600;
    const a = track[i].assist;
    if (a !== null) modeS[a] = (modeS[a] ?? 0) + dt;
  }
  const seconds = Math.max(0, track[to].s - track[from].s);
  const total = Object.values(modeS).reduce((a, b) => a + b, 0) || 1;
  const b0 = track[from].battery;
  const b1 = track[to].battery;
  return {
    seconds,
    km: track[to].km - track[from].km,
    gainM: Math.max(0, (track[to].alt ?? 0) - (track[from].alt ?? 0)),
    riderWh,
    motorWh,
    batteryPct: b0 !== null && b1 !== null ? b0 - b1 : null,
    modes: Object.fromEntries(Object.entries(modeS).map(([k, v]) => [k, v / total])),
  };
}

/**
 * Finds the same climb on another route: passing within `tolerance` metres of
 * its start, then of its top, in that order, over a similar distance.
 */
export function matchClimb(source: TrackPoint[], climb: Climb, other: TrackPoint[], tolerance = 120): { from: number; to: number } | null {
  const start = source[climb.from];
  const top = source[climb.to];
  if (!hasGps(start) || !hasGps(top)) return null;
  let best: { from: number; to: number; err: number } | null = null;
  for (let i = 0; i < other.length; i++) {
    const p = other[i];
    if (!hasGps(p) || metres(p, start) > tolerance) continue;
    for (let j = i + 1; j < other.length; j++) {
      const q = other[j];
      const along = q.km - p.km;
      if (along > climb.km * 1.4 + 0.2) break;
      if (!hasGps(q) || metres(q, top) > tolerance || along < climb.km * 0.7) continue;
      const err = metres(p, start) + metres(q, top);
      if (!best || err < best.err) best = { from: i, to: j, err };
    }
  }
  return best && { from: best.from, to: best.to };
}

/** Everything the comparison page shows for one ride, worked out on the server. */
export function compareRide(ride: RideSummary, track: TrackPoint[], all: { ride: RideSummary; track: TrackPoint[] }[]) {
  const similar = similarRides(ride, track, all).map((o) => ({ ride: o.ride, overlap: o.overlap }));
  const climbs = findClimbs(track)
    .slice(0, 3)
    .map((climb) => ({
      climb,
      efforts: all
        .map((o) => {
          const hit = o.ride.id === ride.id ? { from: climb.from, to: climb.to } : matchClimb(track, climb, o.track);
          return hit ? { ride: o.ride, effort: effort(o.track, hit.from, hit.to) } : null;
        })
        .filter((x): x is { ride: RideSummary; effort: Effort } => x !== null && x.effort.seconds > 0)
        .sort((a, b) => a.ride.start - b.ride.start),
    }));
  return { similar, climbs };
}

export type Comparison = ReturnType<typeof compareRide>;
