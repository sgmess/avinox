import { DEFAULT_TIME_ZONE, type Units } from "./settings.ts";

export const KM_PER_MI = 1.609344;
const FT_PER_M = 3.28084;

const TZ = DEFAULT_TIME_ZONE;

export const distUnit = (u: Units) => (u === "mi" ? "mi" : "km");
export const speedUnit = (u: Units) => (u === "mi" ? "mph" : "km/h");
export const heightUnit = (u: Units) => (u === "mi" ? "ft" : "m");

export const dist = (km: number, u: Units) => (u === "mi" ? km / KM_PER_MI : km);
export const height = (m: number, u: Units) => (u === "mi" ? m * FT_PER_M : m);
/** Energy per unit distance: Wh/km to Wh/mi. */
export const perDist = (whPerKm: number, u: Units) => (u === "mi" ? whPerKm * KM_PER_MI : whPerKm);

export function n(x: number, dp = 0) {
  return x.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export const fmtDist = (km: number, u: Units, dp = 1) => `${n(dist(km, u), dp)} ${distUnit(u)}`;
export const fmtHeight = (m: number, u: Units) => `${n(height(m, u))} ${heightUnit(u)}`;
export const fmtSpeed = (kmh: number, u: Units, dp = 1) => `${n(dist(kmh, u), dp)} ${speedUnit(u)}`;

export function fmtDuration(s: number) {
  const minutes = Math.round(s / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${String(m).padStart(2, "0")}`;
}

export function fmtHours(s: number) {
  const h = s / 3600;
  if (h < 1) return `${Math.round(s / 60)} min`;
  return `${n(h, h < 10 ? 1 : 0)} h`;
}

// Each takes the rider's timezone (Settings), London if none is given.
export const fmtDate = (t: number, tz = TZ) =>
  new Date(t * 1000).toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" });
export const fmtDay = (t: number, tz = TZ) =>
  new Date(t * 1000).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtLongDate = (t: number, tz = TZ) =>
  new Date(t * 1000).toLocaleString("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** "08/10/2026", for searching rides by date. */
export const fmtShortDate = (t: number, tz = TZ) => new Date(t * 1000).toLocaleDateString("en-GB", { timeZone: tz });
/** The hour (0–23) a ride started. */
export const hourOf = (t: number, tz = TZ) => Number(new Date(t * 1000).toLocaleString("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }));

/** "2026-11-07": today's date in a timezone, as a date input wants it. */
export const todayIn = (tz = TZ, now = Date.now()) => new Date(now).toLocaleDateString("en-CA", { timeZone: tz });

/** How far a timezone is ahead of UTC at a moment, ms. */
function zoneOffset(ms: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Unix seconds at midnight starting "2026-11-07" in a timezone (not the device's), or null for a bad date. */
export function dayStart(date: string, tz = TZ): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Guess with the offset at wall-clock midnight, then correct once in case a clock change sits between.
  let ms = wall - zoneOffset(wall, tz);
  ms = wall - zoneOffset(ms, tz);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/** "2026-03" for the month a ride started in. */
export function monthKey(t: number, tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(new Date(t * 1000));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}
