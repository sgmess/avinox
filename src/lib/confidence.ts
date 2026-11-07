import type { RideSummary } from "./ride.ts";
import { fmtDuration } from "./format.ts";

/*
 * How far to trust one ride's figures, from what the import saw: gaps in the
 * recording, damaged readings, checksums that didn't match and sensors that
 * weren't there. "unknown" is a ride imported before these were recorded.
 */

export type ConfidenceLevel = "high" | "fair" | "low" | "unknown";
export type Confidence = { level: ConfidenceLevel; reasons: string[] };

/** Share of the ride's time in gaps, and of readings damaged, past which figures are doubtful (fair) or unreliable (low). */
const GAP_FAIR = 0.05;
const GAP_LOW = 0.3;
const BAD_FAIR = 0.02;
const BAD_LOW = 0.2;
/** Under this share of readings with a sensor, it counts as missing. */
const SENSOR_MIN = 0.5;

const pct = (x: number) => `${x < 0.01 ? "under 1" : Math.round(x * 100)}%`;

export function rideConfidence(r: RideSummary): Confidence {
  if (r.observedS === undefined) {
    return { level: "unknown", reasons: ["Imported before data checks existed: import it again with Update existing rides to check it."] };
  }
  const low: string[] = [];
  const fair: string[] = [];
  if (r.checksumsVerified === false) low.push("No checksum in the file matched, so damaged readings can't be told apart from good ones.");

  const unknownS = r.unknownS ?? 0;
  const total = r.observedS + unknownS;
  const gaps = total ? unknownS / total : 0;
  if (gaps >= GAP_FAIR) {
    (gaps >= GAP_LOW ? low : fair).push(`${fmtDuration(unknownS)} with no readings (${pct(gaps)} of the ride): times, averages and energy only cover the rest.`);
  }

  // At 1 Hz the readings kept roughly equal the seconds observed.
  const bad = r.badFrames ?? 0;
  if (bad && r.checksumsVerified !== false) {
    const share = bad / Math.max(1, r.observedS + bad);
    if (share >= BAD_FAIR) (share >= BAD_LOW ? low : fair).push(`${pct(share)} of readings were damaged and skipped.`);
  }

  if (r.batteryStart === null || r.batteryEnd === null) fair.push("No battery readings: battery use is estimated from the motor's output.");
  if (r.gpsShare !== undefined && r.gpsShare < SENSOR_MIN) fair.push(`GPS on only ${pct(r.gpsShare)} of readings: the map, heatmap and route comparisons are partial.`);
  if (r.altitudeShare !== undefined && r.altitudeShare < SENSOR_MIN) fair.push(`Altitude on only ${pct(r.altitudeShare)} of readings: climbs and gradients may be missing.`);

  if (low.length) return { level: "low", reasons: [...low, ...fair] };
  if (fair.length) return { level: "fair", reasons: fair };
  return { level: "high", reasons: [] };
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = { high: "High", fair: "Fair", low: "Low", unknown: "Not checked" };
export const CONFIDENCE_COLOR: Record<ConfidenceLevel, string> = { high: "var(--good)", fair: "var(--warn)", low: "var(--hot)", unknown: "var(--muted)" };
