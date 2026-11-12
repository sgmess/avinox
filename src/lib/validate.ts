import type { RideSummary, TrackPoint } from "./ride.ts";
import { TORQUE_BANDS } from "./ride.ts";

// Everything the browser sends is cleaned before it's stored.

const numOr = (v: unknown, fallback: number | null, lo = -1e9, hi = 1e9) => {
  const x = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(x) && x >= lo && x <= hi ? x : fallback;
};
const num = (v: unknown, lo?: number, hi?: number) => numOr(v, 0, lo, hi) as number;
const opt = (v: unknown, lo?: number, hi?: number) => (v === null || v === undefined ? null : numOr(v, null, lo, hi));

function numMap(v: unknown, max = 1e9): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, x] of Object.entries(v).slice(0, 64)) {
    if (/^\d{1,3}$/.test(k) && typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max) out[k] = x;
  }
  return out;
}

const zones = (v: unknown) => {
  const out = Array.isArray(v) ? v.slice(0, 5).map((x) => num(x, 0, 1e7)) : [];
  while (out.length < 5) out.push(0);
  return out;
};

export const RIDE_ID = /^[A-Za-z0-9]{1,40}-\d{1,10}-\d{1,12}$/;

export function cleanSummary(input: unknown): RideSummary | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (typeof r.id !== "string" || !RIDE_ID.test(r.id)) return null;
  const start = num(r.start, 1_400_000_000, 4_000_000_000);
  if (!start) return null;
  const torque = Array.isArray(r.torqueS) ? r.torqueS.slice(0, TORQUE_BANDS).map((x) => num(x, 0, 1e7)) : [];
  while (torque.length < TORQUE_BANDS) torque.push(0);
  return {
    id: r.id,
    serial: typeof r.serial === "string" ? r.serial.slice(0, 40) : "",
    start,
    end: num(r.end, start, start + 7 * 86400) || start,
    movingS: num(r.movingS, 0, 7 * 86400),
    km: num(r.km, 0, 2000),
    ...(r.movingKm === undefined ? {} : { movingKm: num(r.movingKm, 0, 2000) }),
    ascentM: num(r.ascentM, 0, 50_000),
    descentM: num(r.descentM, 0, 50_000),
    maxKmh: num(r.maxKmh, 0, 120),
    batteryStart: opt(r.batteryStart, 0, 100),
    batteryEnd: opt(r.batteryEnd, 0, 100),
    motorWh: num(r.motorWh, 0, 100_000),
    riderWh: num(r.riderWh, 0, 100_000),
    tempMin: opt(r.tempMin, -60, 120),
    tempMax: opt(r.tempMax, -60, 120),
    tempAvg: opt(r.tempAvg, -60, 120),
    hrAvg: opt(r.hrAvg, 0, 250),
    hrMax: opt(r.hrMax, 0, 250),
    odometerKm: opt(r.odometerKm, 0, 1_000_000),
    modeS: numMap(r.modeS),
    modeKm: numMap(r.modeKm),
    modeMotorWh: numMap(r.modeMotorWh),
    gearS: numMap(r.gearS),
    torqueS: torque,
    maxTorque: num(r.maxTorque, 0, 300),
    // Rides saved before these existed (in an old backup) stay without them, so the app
    // still asks for the file again instead of showing zeros.
    ...(r.observedS === undefined ? {} : {
      observedS: num(r.observedS, 0, 7 * 86400),
      unknownS: num(r.unknownS, 0, 7 * 86400),
      duplicates: num(r.duplicates, 0, 1e7),
      badFrames: num(r.badFrames, 0, 1e7),
      checksumsVerified: r.checksumsVerified !== false,
      ...(r.gpsShare === undefined ? {} : { gpsShare: num(r.gpsShare, 0, 1) }),
      ...(r.altitudeShare === undefined ? {} : { altitudeShare: num(r.altitudeShare, 0, 1) }),
      riderWAvg: num(r.riderWAvg, 0, 5000),
      riderWMax: num(r.riderWMax, 0, 5000),
      motorWAvg: num(r.motorWAvg, 0, 5000),
      motorWMax: num(r.motorWMax, 0, 5000),
      cadenceAvg: num(r.cadenceAvg, 0, 300),
      cadenceMax: num(r.cadenceMax, 0, 300),
      riderKj: opt(r.riderKj, 0, 1e6),
      torqueZoneS: zones(r.torqueZoneS),
      wattZoneS: zones(r.wattZoneS),
      gearPedalS: numMap(r.gearPedalS),
      gearChanges: num(r.gearChanges, 0, 1e6),
      gradeUpPct: num(r.gradeUpPct, 0, 100),
      gradeDownPct: num(r.gradeDownPct, -100, 0),
    }),
  };
}

export function cleanTrack(input: unknown): TrackPoint[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 1200).map((p) => {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    return {
      km: num(o.km, 0, 2000),
      lat: opt(o.lat, -90, 90),
      lng: opt(o.lng, -180, 180),
      alt: opt(o.alt, -500, 9000),
      speed: num(o.speed, 0, 120),
      motorW: num(o.motorW, 0, 5000),
      riderW: num(o.riderW, 0, 5000),
      assist: opt(o.assist, 0, 999),
      hr: opt(o.hr, 0, 250),
      battery: opt(o.battery, 0, 100),
      s: num(o.s, 0, 7 * 86400),
    };
  });
}

/** A JSON request body that's an object (not null, an array or a number), else null. */
export const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export const cleanText = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
