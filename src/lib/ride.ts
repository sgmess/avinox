import type { RideFile, Sample } from "./parseRide.ts";

/** What's kept of each ride: enough for every chart without the raw samples. */
export type RideSummary = {
  id: string;
  serial: string;
  /** Unix seconds. */
  start: number;
  end: number;
  /** Seconds moving (speed over 2 km/h). */
  movingS: number;
  km: number;
  ascentM: number;
  descentM: number;
  maxKmh: number;
  batteryStart: number | null;
  batteryEnd: number | null;
  /** Mechanical energy at the crank and from the motor, Wh. */
  motorWh: number;
  riderWh: number;
  tempMin: number | null;
  tempMax: number | null;
  tempAvg: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  odometerKm: number | null;
  /** Keyed by assist value. */
  modeS: Record<string, number>;
  modeKm: Record<string, number>;
  modeMotorWh: Record<string, number>;
  /** Keyed by gear number. */
  gearS: Record<string, number>;
  /** Seconds of motor torque in 10 Nm bands, index 0 = 0–10 Nm, the last = 110 Nm and over. */
  torqueS: number[];
  maxTorque: number;
  name?: string;
  notes?: string;
};

/** A ride's route and graphs, thinned to a few hundred points. */
export type TrackPoint = {
  km: number;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  speed: number;
  motorW: number;
  riderW: number;
  assist: number | null;
  hr: number | null;
  battery: number | null;
  /** Seconds since the start. */
  s: number;
};

export const TORQUE_BANDS = 12;
const MAX_GAP_S = 10;
const MOVING_KMH = 2;
const TRACK_POINTS = 600;

const add = (o: Record<string, number>, k: number | null, v: number) => {
  if (k === null) return;
  o[k] = (o[k] ?? 0) + v;
};
const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;
const roundAll = (o: Record<string, number>, dp = 1) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, dp)]));

export function rideId(file: Pick<RideFile, "serial" | "rideId" | "start">) {
  return `${(file.serial || "bike").replace(/[^A-Za-z0-9]/g, "")}-${file.rideId}-${file.start}`;
}

export function summarise(file: RideFile): { summary: RideSummary; track: TrackPoint[] } {
  // Ignore duplicate and backwards timestamps without moving the time baseline.
  let latest = -Infinity;
  const s = file.samples.filter((sample) => {
    if (!Number.isFinite(sample.t) || sample.t <= latest) return false;
    latest = sample.t;
    return true;
  });
  const modeS: Record<string, number> = {};
  const modeKm: Record<string, number> = {};
  const modeMotorWh: Record<string, number> = {};
  const gearS: Record<string, number> = {};
  const torqueS = new Array<number>(TORQUE_BANDS).fill(0);
  let movingS = 0;
  let motorWh = 0;
  let riderWh = 0;
  let maxKmh = 0;
  let maxTorque = 0;
  let tempMin: number | null = null;
  let tempMax: number | null = null;
  let tempSum = 0;
  let tempN = 0;
  let hrSum = 0;
  let hrN = 0;
  let hrMax: number | null = null;
  let batteryStart: number | null = null;
  let batteryEnd: number | null = null;
  let odometer: number | null = null;

  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    const prev = s[i - 1];
    const dt = prev ? Math.min(a.t - prev.t, MAX_GAP_S) : 0;
    const dKm = prev ? Math.max(0, a.km - prev.km) : 0;
    const moving = a.speed > MOVING_KMH;

    motorWh += (a.motorPower * dt) / 3600;
    riderWh += (a.riderPower * dt) / 3600;
    add(modeMotorWh, a.assist, (a.motorPower * dt) / 3600);
    add(modeKm, a.assist, dKm);
    if (moving) {
      movingS += dt;
      add(modeS, a.assist, dt);
      if (a.gear) add(gearS, a.gear, dt);
      if (a.motorTorque > 0) torqueS[Math.min(TORQUE_BANDS - 1, Math.floor(a.motorTorque / 10))] += dt;
    }
    // Readings past these are sensor glitches, not a top speed or torque.
    if (a.speed > maxKmh && a.speed < 80) maxKmh = a.speed;
    if (a.motorTorque > maxTorque && a.motorTorque < 200) maxTorque = a.motorTorque;
    if (a.temperature !== null && a.temperature > -40 && a.temperature < 90) {
      tempMin = tempMin === null ? a.temperature : Math.min(tempMin, a.temperature);
      tempMax = tempMax === null ? a.temperature : Math.max(tempMax, a.temperature);
      tempSum += a.temperature;
      tempN++;
    }
    if (a.heartRate && a.heartRate > 30 && a.heartRate < 230) {
      hrSum += a.heartRate;
      hrN++;
      hrMax = Math.max(hrMax ?? 0, a.heartRate);
    }
    if (a.battery !== null && a.battery >= 0 && a.battery <= 100) {
      if (batteryStart === null) batteryStart = a.battery;
      batteryEnd = a.battery;
    }
    if (a.odometerKm) odometer = a.odometerKm;
  }

  const last = s[s.length - 1];
  const first = s[0];
  const start = file.start || first?.t || 0;
  const summary: RideSummary = {
    id: rideId(file),
    serial: file.serial,
    start,
    end: file.end > start ? file.end : last?.t ?? start,
    movingS: Math.round(movingS),
    km: round(last ? last.km - (first?.km ?? 0) : 0, 3),
    ascentM: round(file.ascentM || climb(s, 1), 0),
    descentM: round(file.descentM || climb(s, -1), 0),
    maxKmh: round(maxKmh, 1),
    batteryStart,
    batteryEnd,
    motorWh: round(motorWh, 1),
    riderWh: round(riderWh, 1),
    tempMin,
    tempMax,
    tempAvg: tempN ? round(tempSum / tempN, 1) : null,
    hrAvg: hrN ? Math.round(hrSum / hrN) : null,
    hrMax,
    odometerKm: odometer === null ? null : round(odometer, 1),
    modeS: roundAll(modeS, 0),
    modeKm: roundAll(modeKm, 3),
    modeMotorWh: roundAll(modeMotorWh, 1),
    gearS: roundAll(gearS, 0),
    torqueS: torqueS.map((v) => Math.round(v)),
    maxTorque: round(maxTorque, 1),
  };
  return { summary, track: thin(s, start) };
}

/** Climb or descent from the altitude, ignoring sub-metre noise. */
function climb(s: Sample[], dir: 1 | -1) {
  let total = 0;
  let base: number | null = null;
  for (const a of s) {
    if (a.altitude === null) continue;
    if (base === null) base = a.altitude;
    const d = (a.altitude - base) * dir;
    if (d >= 1) {
      total += d;
      base = a.altitude;
    } else if (d <= -1) base = a.altitude;
  }
  return total;
}

function thin(s: Sample[], start: number): TrackPoint[] {
  if (!s.length) return [];
  const count = Math.min(s.length, TRACK_POINTS);
  const indices = Array.from({ length: count }, (_, i) => Math.floor(i * (s.length - 1) / Math.max(1, count - 1)));
  const out: TrackPoint[] = [];
  for (const [j, i] of indices.entries()) {
    // Average the powers over the step so short bursts still show.
    const chunk = s.slice(i, indices[j + 1] ?? s.length);
    const mean = (f: (x: Sample) => number) => chunk.reduce((t, x) => t + f(x), 0) / chunk.length;
    const a = s[i];
    out.push({
      km: round(a.km - s[0].km, 3),
      lat: a.lat === null ? null : round(a.lat, 6),
      lng: a.lng === null ? null : round(a.lng, 6),
      alt: a.altitude === null ? null : round(a.altitude, 1),
      speed: round(mean((x) => x.speed), 1),
      motorW: Math.round(mean((x) => x.motorPower)),
      riderW: Math.round(mean((x) => x.riderPower)),
      assist: a.assist,
      hr: a.heartRate,
      battery: a.battery,
      s: a.t - start,
    });
  }
  return out;
}
