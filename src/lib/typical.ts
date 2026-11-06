import type { RideSummary } from "./ride.ts";
import type { Settings } from "./settings.ts";
import { avgKmh, median, rideWhPerKm } from "./stats.ts";

/** Medians across all rides, to say whether one ride was long, hilly or thirsty. */
export type Typical = { km: number; movingS: number; ascentM: number; kmh: number | null; whPerKm: number | null };

/** Medians across rides of 3 km or more, to compare one ride against. */
export function typicalRide(rides: RideSummary[], s: Settings, efficiency: number): Typical | null {
  const rs = rides.filter((r) => r.km >= 3 && r.movingS > 0);
  if (rs.length < 5) return null;
  return {
    km: median(rs.map((r) => r.km))!,
    movingS: median(rs.map((r) => r.movingS))!,
    ascentM: median(rs.map((r) => r.ascentM))!,
    kmh: median(rs.map(avgKmh).filter((x): x is number => x !== null)),
    whPerKm: median(rs.map((r) => rideWhPerKm(r, s, efficiency)).filter((x): x is number => x !== null)),
  };
}
