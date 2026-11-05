import { monthKey } from "./format.ts";
import type { RideSummary } from "./ride.ts";
import { TORQUE_BANDS } from "./ride.ts";
import { modeColor, modeName, modeRank, type Settings } from "./settings.ts";

/** Motor output over the energy it took from the pack, when the rides can't tell us. */
export const DEFAULT_EFFICIENCY = 0.8;
/** Under this drop the 1% battery steps are too coarse to measure a ride. */
const MIN_DROP_PCT = 20;
const HEALTH_WINDOW = 10;
const COLD_C = 10;
const MILD_C = 15;

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const batteryDrop = (r: RideSummary) =>
  r.batteryStart !== null && r.batteryEnd !== null && r.batteryStart > r.batteryEnd ? r.batteryStart - r.batteryEnd : 0;

/** Energy taken from the pack, Wh, from the battery gauge or else the motor. */
export function packWh(r: RideSummary, s: Settings, efficiency: number) {
  const drop = batteryDrop(r);
  return drop ? (drop / 100) * s.batteryWh : r.motorWh / efficiency;
}

/** Pack Wh per km for one ride, or null when it's too short to say. */
export function rideWhPerKm(r: RideSummary, s: Settings, efficiency: number) {
  if (r.km < 1) return null;
  return packWh(r, s, efficiency) / r.km;
}

/** How much motor output a full battery gives, worked out from rides that used a good part of it. */
export function measureEfficiency(rides: RideSummary[], s: Settings) {
  const fit = rides.filter((r) => batteryDrop(r) >= MIN_DROP_PCT);
  const motor = sum(fit.map((r) => r.motorWh));
  const pack = sum(fit.map((r) => (batteryDrop(r) / 100) * s.batteryWh));
  const e = pack ? motor / pack : 0;
  return e >= 0.55 && e <= 0.95 ? e : DEFAULT_EFFICIENCY;
}

export type Stats = ReturnType<typeof computeStats>;

export function computeStats(all: RideSummary[], s: Settings, now = Date.now() / 1000) {
  const rides = [...all].sort((a, b) => a.start - b.start);
  const efficiency = measureEfficiency(rides, s);

  // Totals
  const km = sum(rides.map((r) => r.km));
  const movingS = sum(rides.map((r) => r.movingS));
  const ascentM = sum(rides.map((r) => r.ascentM));
  const wh = sum(rides.map((r) => packWh(r, s, efficiency)));
  const year = 365 * 86400;
  const whPerKm = (rs: RideSummary[]) => {
    const k = sum(rs.map((r) => r.km));
    return k > 5 ? sum(rs.map((r) => packWh(r, s, efficiency))) / k : null;
  };
  const thisYear = whPerKm(rides.filter((r) => r.start > now - year));
  const lastYear = whPerKm(rides.filter((r) => r.start <= now - year && r.start > now - 2 * year));

  // Months, including empty ones so gaps show
  const months: { key: string; km: number; rides: number; ascentM: number }[] = [];
  if (rides.length) {
    const byMonth = new Map<string, { km: number; rides: number; ascentM: number }>();
    for (const r of rides) {
      const k = monthKey(r.start);
      const m = byMonth.get(k) ?? { km: 0, rides: 0, ascentM: 0 };
      m.km += r.km;
      m.rides++;
      m.ascentM += r.ascentM;
      byMonth.set(k, m);
    }
    let [y, mo] = monthKey(rides[0].start).split("-").map(Number);
    const last = monthKey(rides[rides.length - 1].start);
    for (;;) {
      const key = `${y}-${String(mo).padStart(2, "0")}`;
      months.push({ key, ...(byMonth.get(key) ?? { km: 0, rides: 0, ascentM: 0 }) });
      if (key === last || months.length > 600) break;
      mo++;
      if (mo > 12) {
        mo = 1;
        y++;
      }
    }
  }

  // Assist modes: time, distance and what each costs per km
  const modeS: Record<string, number> = {};
  const modeKm: Record<string, number> = {};
  const modeWh: Record<string, number> = {};
  for (const r of rides) {
    for (const [k, v] of Object.entries(r.modeS)) modeS[k] = (modeS[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.modeKm)) modeKm[k] = (modeKm[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.modeMotorWh)) modeWh[k] = (modeWh[k] ?? 0) + v;
  }
  const assistedS = sum(Object.entries(modeS).filter(([k]) => Number(k) !== 0).map(([, v]) => v));
  const modes = Object.keys({ ...modeS, ...modeKm })
    .filter((k) => (modeS[k] ?? 0) >= 60 || (modeKm[k] ?? 0) >= 0.5)
    .map((k) => ({
      value: k,
      name: modeName(s, k),
      color: modeColor(s, k),
      seconds: modeS[k] ?? 0,
      km: modeKm[k] ?? 0,
      // Pack energy per km in this mode, from the motor's output
      whPerKm: (modeKm[k] ?? 0) >= 2 ? (modeWh[k] ?? 0) / efficiency / modeKm[k] : null,
    }))
    .sort((a, b) => modeRank(s, a.value) - modeRank(s, b.value));

  // Battery health: motor output per 1% of battery, early rides against recent ones
  const healthRides = rides.filter((r) => batteryDrop(r) >= MIN_DROP_PCT && r.motorWh > 0);
  const perPct = healthRides.map((r) => ({ t: r.start, v: r.motorWh / batteryDrop(r) }));
  let health: { pct: number; usableWh: number; series: { t: number; pct: number }[] } | null = null;
  if (perPct.length >= HEALTH_WINDOW + 2) {
    const base = median(perPct.slice(0, HEALTH_WINDOW).map((p) => p.v))!;
    const series = perPct.map((p, i) => ({
      t: p.t,
      pct: (median(perPct.slice(Math.max(0, i - HEALTH_WINDOW + 1), i + 1).map((q) => q.v))! / base) * 100,
    }));
    const pct = Math.min(100, series[series.length - 1].pct);
    health = { pct, usableWh: (s.batteryWh * pct) / 100, series };
  }

  // Cold: pack Wh per km on cold rides against mild ones
  const ridesWithTemp = rides.filter((r) => r.tempMin !== null && r.km >= 3);
  const cold = median(ridesWithTemp.filter((r) => r.tempMin! < COLD_C).map((r) => rideWhPerKm(r, s, efficiency)!).filter(Boolean));
  const mild = median(ridesWithTemp.filter((r) => r.tempMin! >= MILD_C).map((r) => rideWhPerKm(r, s, efficiency)!).filter(Boolean));
  const coldExtra = cold && mild && ridesWithTemp.length >= 6 ? cold / mild - 1 : null;
  const tempBands = [
    { label: "Under 5°", lo: -99, hi: 5 },
    { label: "5–10°", lo: 5, hi: 10 },
    { label: "10–15°", lo: 10, hi: 15 },
    { label: "15–20°", lo: 15, hi: 20 },
    { label: "20–25°", lo: 20, hi: 25 },
    { label: "25° +", lo: 25, hi: 99 },
  ].map((b) => {
    const rs = ridesWithTemp.filter((r) => r.tempMin! >= b.lo && r.tempMin! < b.hi);
    return { label: b.label, rides: rs.length, whPerKm: median(rs.map((r) => rideWhPerKm(r, s, efficiency)!).filter(Boolean)) };
  });

  // Range on a full battery for each assisted mode
  const usableWh = health?.usableWh ?? s.batteryWh;
  const range = modes
    .filter((m) => m.whPerKm && Number(m.value) !== 0 && m.seconds >= 600)
    .map((m) => ({ ...m, km: usableWh / m.whPerKm!, coldKm: coldExtra && coldExtra > 0 ? usableWh / (m.whPerKm! * (1 + coldExtra)) : null }));

  // Gears
  const gearS: Record<string, number> = {};
  for (const r of rides) for (const [k, v] of Object.entries(r.gearS)) gearS[k] = (gearS[k] ?? 0) + v;
  const gearTotal = sum(Object.values(gearS));
  const maxGear = Math.max(0, ...Object.keys(gearS).map(Number));
  const gears = gearTotal ? Array.from({ length: maxGear }, (_, i) => ({ gear: i + 1, share: (gearS[i + 1] ?? 0) / gearTotal })) : [];

  // Torque
  const torqueS = new Array<number>(TORQUE_BANDS).fill(0);
  for (const r of rides) r.torqueS.forEach((v, i) => (torqueS[i] += v));
  const torqueTotal = sum(torqueS);
  const torque = {
    underFifty: torqueTotal ? sum(torqueS.slice(0, 5)) / torqueTotal : null,
    bands: torqueS.slice(5).map((v, i) => ({
      label: i + 5 === TORQUE_BANDS - 1 ? `${(i + 5) * 10} Nm +` : `${(i + 5) * 10}–${(i + 6) * 10} Nm`,
      seconds: v,
      share: torqueTotal ? v / torqueTotal : 0,
      hot: i + 5 >= 10,
    })),
    max: Math.max(0, ...rides.map((r) => r.maxTorque)),
  };

  // Temperature per ride
  const temps = rides.filter((r) => r.tempMin !== null).map((r) => ({ t: r.start, min: r.tempMin!, max: r.tempMax! }));

  // Records
  const top = (f: (r: RideSummary) => number | null) =>
    rides.reduce<RideSummary | null>((best, r) => (f(r) !== null && (best === null || f(r)! > f(best)!) ? r : best), null);
  const records = {
    longest: top((r) => r.km),
    climb: top((r) => r.ascentM),
    speed: top((r) => r.maxKmh),
    time: top((r) => r.movingS),
    coldest: top((r) => (r.tempMin === null ? null : -r.tempMin)),
  };

  return {
    rides,
    efficiency,
    totals: { rides: rides.length, km, movingS, assistedS, ascentM, wh, whPerKm: whPerKm(rides), thisYear, lastYear },
    months,
    modes,
    health,
    coldExtra,
    tempBands,
    range,
    gears,
    torque,
    temps,
    records,
  };
}

/** A ride's assisted time split by mode, for the little stacked bars. */
export function modeParts(r: RideSummary, s: Settings) {
  const total = Object.entries(r.modeS)
    .filter(([k]) => Number(k) !== 0)
    .reduce((a, [, v]) => a + v, 0);
  if (!total) return [];
  return Object.entries(r.modeS)
    .filter(([k, v]) => v > 0 && Number(k) !== 0)
    .sort(([a], [b]) => modeRank(s, a) - modeRank(s, b))
    .map(([k, v]) => ({ key: k, share: v / total, color: modeColor(s, k), name: modeName(s, k) }));
}
