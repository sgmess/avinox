import { test } from "node:test";
import assert from "node:assert/strict";
import { climbModel, compareRide, effort, finishCharge, findClimbs, hillBands, matchClimb, overlap, cells, planRide, planSpread, similarRides } from "./insights.ts";
import { readBackup } from "./backup.ts";
import { demoRides } from "./demo.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import type { RideSummary, TrackPoint } from "./ride.ts";

const S = DEFAULT_SETTINGS;
const base = demoRides().summaries[0];

/** A ride whose battery use is exactly 8 Wh/km plus 0.5 Wh per metre climbed (800 Wh pack). */
function ride(i: number, km: number, climbM: number): RideSummary {
  const wh = 8 * km + 0.5 * climbM;
  return { ...base, id: `T-${i}-${1_700_000_000 + i}`, start: 1_700_000_000 + i * 86400, km, ascentM: climbM, batteryStart: 100, batteryEnd: 100 - (wh / 800) * 100 };
}

test("climbing cost is split from distance cost", () => {
  const rides = [ride(1, 20, 100), ride(2, 30, 900), ride(3, 25, 300), ride(4, 40, 1600), ride(5, 15, 50), ride(6, 35, 400), ride(7, 22, 700), ride(8, 50, 600), ride(9, 28, 1000)];
  const m = climbModel(rides, S, 0.8)!;
  assert.ok(Math.abs(m.flatWhPerKm - 8) < 0.01, `flat ${m.flatWhPerKm}`);
  assert.ok(Math.abs(m.whPerM - 0.5) < 0.001, `climb ${m.whPerM}`);
  assert.equal(climbModel(rides.slice(0, 5), S, 0.8), null, "too few rides");
  // All the same steepness: climbing and distance can't be told apart.
  assert.equal(climbModel(Array.from({ length: 10 }, (_, i) => ride(i, 10 + i, (10 + i) * 20)), S, 0.8), null);
  const bands = hillBands(rides, S, 0.8);
  assert.equal(bands.reduce((a, b) => a + b.rides, 0), rides.length);
  assert.ok(bands[0].whPerKm! < bands[3].whPerKm!);
});

test("the planner prices the route, then scales it by each mode", () => {
  const modes = [
    { value: "1", name: "Eco", color: "", whPerKm: 6, seconds: 3600 },
    { value: "3", name: "Turbo", color: "", whPerKm: 12, seconds: 3600 },
    { value: "0", name: "Off", color: "", whPerKm: 1, seconds: 3600 },
    { value: "2", name: "Trail", color: "", whPerKm: 9, seconds: 60 },
  ];
  const plan = planRide({ km: 40, climbM: 800 }, modes, 8, { flatWhPerKm: 8, whPerM: 0.5, rides: 10 }, 720, 0.1);
  assert.deepEqual(plan.map((p) => p.name), ["Eco", "Turbo"], "off and barely used modes are left out");
  // Route: 8×40 + 0.5×800 = 720 Wh at the average mix; Eco is 6/8 of that.
  assert.ok(Math.abs(plan[0].pct - 75) < 1e-9);
  assert.ok(Math.abs(plan[1].pct - 150) < 1e-9);
  assert.ok(Math.abs(plan[0].coldPct! - 82.5) < 1e-9);
  // Without a climb model, distance only.
  assert.ok(Math.abs(planRide({ km: 40, climbM: 800 }, modes, 8, null, 720, null)[0].pct - (6 * 40 * 100) / 720) < 1e-9);
});

/** A straight route north, climbing 100 m in the middle kilometre. */
function line(offsetKm = 0, latShift = 0): TrackPoint[] {
  return Array.from({ length: 301 }, (_, i) => {
    const km = i / 100;
    const alt = km < 1 ? 50 : km < 2 ? 50 + (km - 1) * 100 : 150 - (km - 2) * 30;
    return { km: km + offsetKm, lat: 52 + km / 111.195 + latShift, lng: -2, alt, speed: 15, motorW: 200, riderW: 100, assist: km < 1.5 ? 1 : 3, hr: null, battery: 90 - Math.floor(km * 2), s: i * 12 };
  });
}

test("climbs are found and matched on another ride", () => {
  const a = line();
  const climbs = findClimbs(a);
  assert.equal(climbs.length, 1);
  // The climb starts within 1 m of the bottom.
  assert.ok(Math.abs(climbs[0].gainM - 100) <= 1.01 && Math.abs(climbs[0].km - 1) < 0.02, JSON.stringify(climbs[0]));
  // The same road ridden later in a longer ride.
  const b = [...line(5).map((p) => ({ ...p, s: p.s + 600 }))];
  const hit = matchClimb(a, climbs[0], b)!;
  assert.ok(hit);
  const e = effort(b, hit.from, hit.to);
  assert.ok(Math.abs(e.km - 1) < 0.05);
  assert.ok(Math.abs(e.seconds - 1200) < 30);
  assert.ok(Math.abs(e.riderWh - (100 * e.seconds) / 3600) < 0.5);
  assert.ok(e.modes["1"] > 0.4 && e.modes["3"] > 0.4);
  // A road 2 km away doesn't match.
  assert.equal(matchClimb(a, climbs[0], line(0, 0.02)), null);
});

test("similar routes overlap; different ones don't", () => {
  const a = line();
  assert.equal(overlap(cells(a), cells(a)), 1);
  assert.equal(overlap(cells(a), cells(line(0, 0.05))), 0);
  const r = (id: string, km: number) => ({ ...base, id, km });
  const found = similarRides(r("A-1-1", 3), a, [
    { ride: r("A-1-1", 3), track: a },
    { ride: r("B-1-1", 3.1), track: line() },
    { ride: r("C-1-1", 3), track: line(0, 0.05) },
    { ride: r("D-1-1", 9), track: line() },
  ]);
  assert.deepEqual(found.map((f) => f.ride.id), ["B-1-1"]);
});

test("demo rides repeat routes, so they have rides and climbs to compare", () => {
  const { summaries, tracks } = demoRides();
  const all = summaries.map((r) => ({ ride: r, track: tracks[r.id] }));
  const hilly = summaries.find((r) => r.ascentM > 300)!;
  const cmp = compareRide(hilly, tracks[hilly.id], all);
  assert.ok(cmp.similar.length >= 3, `similar ${cmp.similar.length}`);
  assert.ok(cmp.climbs.length >= 1);
  assert.ok(cmp.climbs[0].efforts.length >= 3, `efforts ${cmp.climbs[0].efforts.length}`);
});

test("backups are recognised", () => {
  assert.equal(readBackup({ app: "ride-stats", version: 1, rides: [] }).ok, true);
  assert.equal(readBackup({ app: "something", version: 1, rides: [] }).ok, false);
  assert.equal(readBackup({ app: "ride-stats", version: 99, rides: [] }).ok, false);
  assert.equal(readBackup([]).ok, false);
});

test("routes with no points or no altitude have no climbs (and comparing them doesn't crash)", () => {
  const flat: TrackPoint = { km: 0, lat: 52, lng: -2, alt: null, speed: 20, motorW: 200, riderW: 150, assist: 1, hr: null, battery: 90, s: 0 };
  const noAlt = Array.from({ length: 50 }, (_, i) => ({ ...flat, km: i / 10, s: i * 18 }));
  assert.deepEqual(findClimbs([]), []);
  assert.deepEqual(findClimbs(noAlt), []);
  assert.deepEqual(findClimbs(noAlt.slice(0, 1).map((p) => ({ ...p, alt: 100 }))), []);
  assert.deepEqual(compareRide(base, [], []).climbs, []);
  assert.deepEqual(compareRide(base, noAlt, [{ ride: base, track: noAlt }]).climbs, []);
});

test("a gap in the recording adds no time or energy to an effort", () => {
  const p: TrackPoint = { km: 0, lat: 52, lng: -2, alt: 100, speed: 20, motorW: 360, riderW: 200, assist: 2, hr: null, battery: 90, s: 0 };
  // 5 s apart, with an hour missing between the 10th and 11th points.
  const track = Array.from({ length: 21 }, (_, i) => ({ ...p, km: i * 0.03, s: i * 5 + (i > 10 ? 3600 : 0) }));
  const e = effort(track, 0, 20);
  assert.equal(e.seconds, 95);
  assert.ok(Math.abs(e.motorWh - (360 * 95) / 3600) < 1e-9, `motorWh ${e.motorWh}`);
  assert.ok(Math.abs(e.riderWh - (200 * 95) / 3600) < 1e-9);
  assert.deepEqual(e.modes, { "2": 1 });
});

test("the planner's range comes from how past rides landed against it", () => {
  // Rides that cost exactly what the model says, then a few 20% over and under.
  const exact = Array.from({ length: 10 }, (_, i) => ride(i, 20 + i, 200 + i * 60));
  const model = climbModel(exact, S, 0.8)!;
  const tight = planSpread(exact, S, 0.8, 8, model);
  assert.equal(tight.rides, 10);
  // Exact rides still get the ±5% floor for the gauge's 1% steps.
  assert.ok(Math.abs(tight.lo - 0.95) < 1e-9 && Math.abs(tight.hi - 1.05) < 1e-9, `${tight.lo} ${tight.hi}`);
  const noisy = exact.map((r, i) => (i % 3 === 0 ? { ...r, batteryEnd: 100 - (100 - r.batteryEnd!) * (i % 2 ? 1.2 : 0.8) } : r));
  const wide = planSpread(noisy, S, 0.8, 8, climbModel(noisy, S, 0.8));
  assert.ok(wide.lo < 0.95 && wide.hi > 1.05, `${wide.lo} ${wide.hi}`);
  // Too few rides: a fixed ±25%.
  assert.deepEqual(planSpread(exact.slice(0, 3), S, 0.8, 8, model), { lo: 0.75, hi: 1.25, rides: 3 });
});

test("finishing charge and verdicts", () => {
  const spread = { lo: 0.8, hi: 1.2, rides: 10 };
  const ok = finishCharge(40, spread, 100, 15);
  assert.deepEqual([ok.expected, ok.worst, ok.best, ok.verdict], [60, 52, 68, "comfortable"]);
  assert.equal(ok.reach, 85 / 40);
  assert.equal(finishCharge(75, spread, 100, 15).verdict, "tight");
  assert.equal(finishCharge(90, spread, 100, 15).verdict, "under-reserve");
  assert.equal(finishCharge(60, spread, 50, 15).verdict, "wont-make-it");
  assert.equal(finishCharge(0, spread, 80, 10).reach, Infinity);
});
