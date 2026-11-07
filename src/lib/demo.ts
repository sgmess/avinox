import type { RideFile, Sample } from "./parseRide.ts";
import { summarise, type RideSummary, type TrackPoint } from "./ride.ts";

/*
 * Made-up rides for the demo page and the tests, built as ride files so they
 * go through the same summary code as real ones.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ECO = 1, TRAIL = 2, TURBO = 3, AUTO = 4;
const STEP_S = 5;

export function demoRide(seed: number, start: number, opts: { km: number; hilly: number; modes: [number, number][]; ageDays: number; route?: number }): RideFile {
  const r = rng(seed);
  const month = new Date(start * 1000).getUTCMonth();
  const ambient = 11 - 8 * Math.cos(((month + 0.5) / 12) * 2 * Math.PI) + (r() - 0.5) * 6;
  const health = 1 - Math.min(0.08, opts.ageDays * 0.00012);
  const samples: Sample[] = [];
  // Rides on the same route share its loop and hills, so they can be compared.
  const route = opts.route ?? seed;
  const lat0 = opts.route === undefined ? 52.73 + r() * 0.04 : 52.6 + (route % 3) * 0.09;
  const lng0 = opts.route === undefined ? -2.0 + r() * 0.06 : -2.1 + Math.floor(route / 3) * 0.14;
  const loopKm = opts.km;
  let km = 0;
  let t = start;
  let battery = 100;
  let packWhUsed = 0;
  let riderJ = 0;
  let temp = ambient;
  let modeIdx = 0;
  let modeLeftKm = opts.modes[0][1] * loopKm;

  while (km < loopKm) {
    const phase = (km / loopKm) * 2 * Math.PI;
    const grade = opts.hilly * (Math.sin(phase * 3 + route) * 8 + Math.sin(phase * 7) * 3); // %
    const alt = 150 + opts.hilly * (Math.cos(phase * 3 + route) * -80 / 3 + Math.cos(phase * 7) * -10 / 7) * 6;
    if (modeLeftKm <= 0 && modeIdx < opts.modes.length - 1) {
      modeIdx++;
      modeLeftKm = opts.modes[modeIdx][1] * loopKm;
    }
    const mode = opts.modes[modeIdx][0];
    const factor = mode === ECO ? 0.7 : mode === AUTO ? 0.9 + Math.max(0, grade) / 14 : mode === TRAIL ? 1.2 : 1.9;
    const rider = Math.max(0, 120 + grade * 12 + (r() - 0.5) * 60);
    const speed = Math.max(4, Math.min(28, 24 - Math.max(0, grade) * 1.4 + (r() - 0.5) * 3 - (grade < -2 ? -6 : 0)));
    const coasting = grade < -3;
    const motor = coasting || speed >= 25 ? 0 : Math.min(800, rider * factor);
    const cadence = coasting ? 0 : 70 + (r() - 0.5) * 20;
    const motorTorque = cadence ? Math.min(120, (motor / ((cadence * 2 * Math.PI) / 60)) * 1) : 0;
    const gear = Math.max(1, Math.min(12, Math.round(2 + speed / 3 - grade * 0.3 + (r() - 0.5) * 3)));
    const dKm = (speed * STEP_S) / 3600;
    // A cold pack gives less: about 1.5% more drain per degree under 10 °C.
    packWhUsed += ((motor * STEP_S) / 3600 / 0.8) * (1 + Math.max(0, 10 - ambient) * 0.015);
    riderJ += rider * STEP_S;
    battery = Math.max(1, Math.round(100 - (packWhUsed / (800 * health)) * 100));
    temp += (motor / 800) * 0.12 - (temp - ambient) * 0.004;

    samples.push({
      t,
      speed,
      assist: mode,
      cadence,
      motorTorque,
      riderTorque: cadence ? rider / ((cadence * 2 * Math.PI) / 60) : 0,
      riderPower: rider,
      motorPower: motor,
      gear,
      km,
      lat: lat0 + 0.03 * Math.sin(phase) + 0.006 * Math.sin(phase * 5),
      lng: lng0 + 0.05 * Math.cos(phase) + 0.008 * Math.cos(phase * 3),
      altitude: alt,
      temperature: Math.round(temp * 10) / 10,
      heartRate: Math.round(110 + rider / 6),
      battery,
      odometerKm: null,
      energyJ: Math.round(riderJ),
    });
    km += dKm;
    modeLeftKm -= dKm;
    t += STEP_S;
  }
  return { rideId: seed, serial: "DEMO", start, end: t, ascentM: 0, descentM: 0, samples, badFrames: 0, checksumsVerified: true };
}

const DEMO_ROUTES = [
  { km: 25, hilly: 0.15 },
  { km: 22, hilly: 0.7 },
  { km: 34, hilly: 1.1 },
  { km: 46, hilly: 0.9 },
  { km: 30, hilly: 0.6 },
  { km: 55, hilly: 1.2 },
];

/** About 18 months of riding up to `until` (unix seconds). */
export function demoRides(until = Date.UTC(2026, 9, 9) / 1000): { summaries: RideSummary[]; tracks: Record<string, TrackPoint[]> } {
  const r = rng(42);
  const first = until - 520 * 86400;
  const summaries: RideSummary[] = [];
  const tracks: Record<string, TrackPoint[]> = {};
  let id = 1;
  for (let day = first; day <= until; day += 86400) {
    const month = new Date(day * 1000).getUTCMonth();
    const keen = month >= 3 && month <= 9 ? 0.32 : 0.14;
    if (r() > keen) continue;
    const kind = r();
    const hour = 7 + Math.floor(r() * 11);
    const start = day + hour * 3600;
    const modes: [number, number][] =
      kind < 0.25
        ? [[TURBO, 1]]
        : kind < 0.45
          ? [[AUTO, 0.6], [TRAIL, 0.4]]
          : kind < 0.55
            ? [[ECO, 0.5], [AUTO, 0.5]]
            : [[TRAIL, 0.6 + r() * 0.2], [TURBO, 0.4]];
    // The flat commute, or one of five hillier loops ridden again and again.
    const route = kind < 0.25 ? 0 : 1 + Math.floor(r() * (DEMO_ROUTES.length - 1));
    const ride = demoRide(id++, start, {
      km: DEMO_ROUTES[route].km * (0.98 + r() * 0.04),
      hilly: DEMO_ROUTES[route].hilly,
      modes,
      ageDays: (start - first) / 86400,
      route,
    });
    const { summary, track } = summarise(ride);
    summaries.push(summary);
    tracks[summary.id] = track;
  }
  return { summaries, tracks };
}
