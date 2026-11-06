import type { RideSummary, TrackPoint } from "./ride.ts";
import type { Settings } from "./settings.ts";

/*
 * A backup is one JSON file: settings, then every ride's details (name and
 * notes included) with its route. Restoring sends it back a few rides at a
 * time, each cleaned by the server exactly like an import.
 */

export const BACKUP_APP = "ride-stats";
export const BACKUP_VERSION = 1;
/** Rides per restore request: small enough to stay well under request limits. */
export const RESTORE_BATCH = 15;

export type BackupRide = RideSummary & { track: TrackPoint[] };
export type Backup = { app: typeof BACKUP_APP; version: number; exportedAt: string; settings: Settings; rides: BackupRide[] };

/** Checks a parsed file is a backup this app can restore, and says why not. */
export function readBackup(data: unknown): { ok: true; backup: Backup } | { ok: false; why: string } {
  const o = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!o || o.app !== BACKUP_APP) return { ok: false, why: "This isn't a Ride Stats backup." };
  if (typeof o.version !== "number" || o.version > BACKUP_VERSION) return { ok: false, why: "This backup was made by a newer version of the app." };
  if (!Array.isArray(o.rides)) return { ok: false, why: "This backup has no rides list." };
  return { ok: true, backup: o as unknown as Backup };
}
