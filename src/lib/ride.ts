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
  /** Distance covered while moving, outside gaps in the recording: the distance that goes with movingS. */
  movingKm?: number;
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
  /*
   * Added with the stats from sgmess/avinox-stats. Rides imported before then
   * don't have these until they're imported again with "Update existing rides".
   */
  /** Seconds covered by samples a short gap apart, and seconds in longer gaps. */
  observedS?: number;
  unknownS?: number;
  /** Samples sharing a timestamp (the last one is kept) and frames dropped for a bad checksum. */
  duplicates?: number;
  badFrames?: number;
  /** False when the file was read without its checksums (see parseRide). */
  checksumsVerified?: boolean;
  /** Share of readings (0–1) with a GPS position and with altitude. */
  gpsShare?: number;
  altitudeShare?: number;
  /** Averages count only the time each is above zero. W and rpm. */
  riderWAvg?: number;
  riderWMax?: number;
  motorWAvg?: number;
  motorWMax?: number;
  cadenceAvg?: number;
  cadenceMax?: number;
  /** Rider work as the bike counted it (field 52), kJ. */
  riderKj?: number | null;
  /** Seconds of motor torque in ZONE_TORQUE bands and motor power in ZONE_WATTS bands. */
  torqueZoneS?: number[];
  wattZoneS?: number[];
  /** Seconds in each gear while pedalling. */
  gearPedalS?: Record<string, number>;
  gearChanges?: number;
  /** Steepest climb and descent over 100 m, %. */
  gradeUpPct?: number;
  gradeDownPct?: number;
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
/** Upper limits of the first four zones; the fifth is everything above. */
export const ZONE_TORQUE = [30, 60, 85, 105];
export const ZONE_WATTS = [150, 350, 600, 850];
/** The shortest gap that counts as missing data, whatever the sample rate. */
const MIN_GAP_LIMIT_S = 2;
const MOVING_KMH = 2;
export const TRACK_POINTS = 1200;
/** Readings past these are sensor glitches. They count as nothing, so they can't skew totals, zones or graphs. */
const MAX_W = 3000;
const MAX_NM = 200;
const MAX_RPM = 250;
const MAX_KMH = 80;
export const MAX_GEAR = 14;

const add = (o: Record<string, number>, k: number | null, v: number) => {
  if (k === null) return;
  o[k] = (o[k] ?? 0) + v;
};
const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;
const roundAll = (o: Record<string, number>, dp = 1) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, dp)]));

export function rideId(file: Pick<RideFile, "serial" | "rideId" | "start">) {
  return `${(file.serial || "bike").replace(/[^A-Za-z0-9]/g, "")}-${file.rideId}-${file.start}`;
}

/**
 * Puts samples in time order, keeping the last one at each timestamp, and
 * weights each by the time to the next. A sample holds for one missed reading
 * (up to twice the usual interval, so 2 s at the bike's 1 Hz); longer gaps are
 * unknown time, not counted as riding, stopping or any mode.
 */
export function timeline(samples: Sample[]) {
  const sorted = samples.filter((x) => Number.isFinite(x.t) && x.t > 0).sort((a, b) => a.t - b.t);
  const s: Sample[] = [];
  for (const x of sorted) {
    if (s.length && s[s.length - 1].t === x.t) s[s.length - 1] = x;
    else s.push(x);
  }
  const steps = s.slice(1).map((x, i) => x.t - s[i].t).sort((a, b) => a - b);
  const usual = steps.length ? steps[Math.floor(steps.length / 2)] : 1;
  const limit = Math.max(MIN_GAP_LIMIT_S, 2 * usual);
  let unknownS = 0;
  const weights = s.map((x, i) => {
    const dt = i + 1 < s.length ? s[i + 1].t - x.t : 0;
    if (dt > limit) {
      unknownS += dt;
      return 0;
    }
    return dt;
  });
  return { s, weights, unknownS, duplicates: sorted.length - s.length };
}

/**
 * Drops glitched readings and rebuilds distance as a running total of forward
 * steps, so a trip counter that resets mid-ride, or one impossible jump, can't
 * make the ride shorter or longer than it was.
 */
export function cleanSamples(s: Sample[]): Sample[] {
  let km = 0;
  return s.map((x, i) => {
    if (i > 0) {
      const step = x.km - s[i - 1].km;
      const dt = Math.max(1, x.t - s[i - 1].t);
      if (step > 0 && step <= (MAX_KMH * dt) / 3600 + 0.05) km += step;
    }
    const ok = (v: number, max: number) => (v > 0 && v < max ? v : 0);
    return {
      ...x,
      km,
      speed: ok(x.speed, MAX_KMH),
      cadence: ok(x.cadence, MAX_RPM),
      motorTorque: ok(x.motorTorque, MAX_NM),
      riderTorque: ok(x.riderTorque, MAX_NM),
      riderPower: ok(x.riderPower, MAX_W),
      motorPower: ok(x.motorPower, MAX_W),
      gear: x.gear !== null && x.gear >= 1 && x.gear <= MAX_GEAR ? x.gear : null,
    };
  });
}

function zone(v: number, limits: number[]) {
  // The fourth zone's upper limit is inclusive (105 Nm, 850 W).
  let i = 0;
  while (i < 3 && v >= limits[i]) i++;
  return i === 3 && v > limits[3] ? 4 : i;
}

export function summarise(file: RideFile): { summary: RideSummary; track: TrackPoint[] } {
  const t = timeline(file.samples);
  const { weights, unknownS, duplicates } = t;
  const s = cleanSamples(t.s);
  const modeS: Record<string, number> = {};
  const modeKm: Record<string, number> = {};
  const modeMotorWh: Record<string, number> = {};
  const gearS: Record<string, number> = {};
  const gearPedalS: Record<string, number> = {};
  const torqueS = new Array<number>(TORQUE_BANDS).fill(0);
  const torqueZoneS = [0, 0, 0, 0, 0];
  const wattZoneS = [0, 0, 0, 0, 0];
  let observedS = 0;
  let movingS = 0;
  let movingKm = 0;
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
  const power = { rider: 0, riderS: 0, riderMax: 0, motor: 0, motorS: 0, motorMax: 0, cadence: 0, cadenceS: 0, cadenceMax: 0 };
  let energyJ: number | null = null;
  let gearChanges = 0;

  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    const next = s[i + 1];
    const dt = weights[i];
    const dKm = next && dt ? Math.max(0, next.km - a.km) : 0;
    const moving = a.speed > MOVING_KMH;

    observedS += dt;
    motorWh += (a.motorPower * dt) / 3600;
    riderWh += (a.riderPower * dt) / 3600;
    add(modeMotorWh, a.assist, (a.motorPower * dt) / 3600);
    add(modeKm, a.assist, dKm);
    if (moving) {
      movingS += dt;
      movingKm += dKm;
      add(modeS, a.assist, dt);
      if (a.gear) add(gearS, a.gear, dt);
      if (a.motorTorque > 0) torqueS[Math.min(TORQUE_BANDS - 1, Math.floor(a.motorTorque / 10))] += dt;
    }
    if (a.gear && a.cadence > 0) add(gearPedalS, a.gear, dt);
    // A change only counts when the last sample was close enough in time to see it.
    const prev = s[i - 1];
    if (prev && weights[i - 1] > 0 && a.gear && prev.gear && a.gear !== prev.gear) gearChanges++;
    if (a.motorTorque > 0) torqueZoneS[zone(a.motorTorque, ZONE_TORQUE)] += dt;
    if (a.motorPower > 0) wattZoneS[zone(a.motorPower, ZONE_WATTS)] += dt;
    // Glitched readings are already zero (cleanSamples).
    maxKmh = Math.max(maxKmh, a.speed);
    maxTorque = Math.max(maxTorque, a.motorTorque);
    if (a.riderPower > 0) {
      power.rider += a.riderPower * dt;
      power.riderS += dt;
      power.riderMax = Math.max(power.riderMax, a.riderPower);
    }
    if (a.motorPower > 0) {
      power.motor += a.motorPower * dt;
      power.motorS += dt;
      power.motorMax = Math.max(power.motorMax, a.motorPower);
    }
    if (a.cadence > 0) {
      power.cadence += a.cadence * dt;
      power.cadenceS += dt;
      power.cadenceMax = Math.max(power.cadenceMax, a.cadence);
    }
    if (a.energyJ !== null && a.energyJ > 0) energyJ = Math.max(energyJ ?? 0, a.energyJ);
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
  const elevation = climb(s);
  const grade = steepest(s);
  const avg = (sum: number, secs: number) => (secs ? round(sum / secs, 1) : 0);
  const summary: RideSummary = {
    id: rideId(file),
    serial: file.serial,
    start,
    end: file.end > start ? file.end : last?.t ?? start,
    movingS: Math.round(movingS),
    km: round(last?.km ?? 0, 3),
    movingKm: round(movingKm, 3),
    ascentM: round(file.ascentM || elevation.up, 0),
    descentM: round(file.descentM || elevation.down, 0),
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
    observedS: Math.round(observedS),
    unknownS: Math.round(unknownS),
    duplicates,
    badFrames: file.badFrames ?? 0,
    checksumsVerified: file.checksumsVerified,
    gpsShare: s.length ? round(s.filter((x) => x.lat !== null && x.lng !== null).length / s.length, 3) : 0,
    altitudeShare: s.length ? round(s.filter((x) => x.altitude !== null).length / s.length, 3) : 0,
    riderWAvg: avg(power.rider, power.riderS),
    riderWMax: round(power.riderMax, 1),
    motorWAvg: avg(power.motor, power.motorS),
    motorWMax: round(power.motorMax, 1),
    cadenceAvg: avg(power.cadence, power.cadenceS),
    cadenceMax: round(power.cadenceMax, 1),
    riderKj: energyJ === null ? null : round(energyJ / 1000, 1),
    torqueZoneS: torqueZoneS.map((v) => Math.round(v)),
    wattZoneS: wattZoneS.map((v) => Math.round(v)),
    gearPedalS: roundAll(gearPedalS, 0),
    gearChanges,
    gradeUpPct: round(grade.up, 1),
    gradeDownPct: round(grade.down, 1),
  };
  return { summary, track: thin(s, start) };
}

/** Means over a window of ±w seconds, for altitude that wobbles a metre or two. */
function smooth(ts: number[], vals: number[], w: number) {
  const out = new Array<number>(vals.length);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < vals.length; i++) {
    while (hi + 1 < vals.length && ts[hi + 1] <= ts[i] + w) sum += vals[++hi];
    while (ts[lo] < ts[i] - w) sum -= vals[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

const withAltitude = (s: Sample[]) => s.filter((a): a is Sample & { altitude: number } => a.altitude !== null);

/** Climb and descent from the altitude, smoothed over 30 s and ignoring changes under 1.5 m. */
function climb(s: Sample[]) {
  const pts = withAltitude(s);
  if (!pts.length) return { up: 0, down: 0 };
  const alt = smooth(pts.map((a) => a.t), pts.map((a) => a.altitude), 30);
  let up = 0;
  let down = 0;
  let base = alt[0];
  for (const x of alt) {
    const d = x - base;
    if (d >= 1.5) {
      up += d;
      base = x;
    } else if (d <= -1.5) {
      down -= d;
      base = x;
    }
  }
  return { up, down };
}

/**
 * Steepest climb and descent over 100 m stretches covered within a minute
 * (6 km/h or faster), on altitude with jumps over 3 m/s taken out.
 */
function steepest(s: Sample[]) {
  const pts = withAltitude(s);
  const n = pts.length;
  if (n < 10) return { up: 0, down: 0 };
  const level = [pts[0].altitude];
  for (let i = 1; i < n; i++) {
    const step = pts[i].altitude - pts[i - 1].altitude;
    level.push(level[i - 1] + (Math.abs(step) > 3 * (pts[i].t - pts[i - 1].t) ? 0 : step));
  }
  const alt = smooth(pts.map((a) => a.t), level, 5);
  let up = 0;
  let down = 0;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (j < i) j = i;
    while (j < n && (pts[j].km - pts[i].km) * 1000 < 100) j++;
    if (j >= n) break;
    if (pts[j].t - pts[i].t > 60) continue;
    const g = ((alt[j] - alt[i]) / ((pts[j].km - pts[i].km) * 1000)) * 100;
    // Anything past 60% is a GPS or barometer glitch on a bike.
    if (g > up && g < 60) up = g;
    if (g < down && g > -60) down = g;
  }
  return { up, down };
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
