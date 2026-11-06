import "server-only";
import { ridesCol, tracksCol, userDoc } from "./firebase-admin";
import type { RideSummary, TrackPoint } from "./ride";
import { cleanSettings, type Settings } from "./settings";

export async function getSettings(uid: string): Promise<Settings> {
  const snap = await userDoc(uid).get();
  return cleanSettings(snap.data()?.settings);
}

export async function listRides(uid: string): Promise<RideSummary[]> {
  const snap = await ridesCol(uid).orderBy("start", "desc").get();
  return snap.docs.map((d) => d.data() as RideSummary);
}

export async function getRide(uid: string, id: string): Promise<{ ride: RideSummary; track: TrackPoint[] } | null> {
  const [ride, track] = await Promise.all([ridesCol(uid).doc(id).get(), tracksCol(uid).doc(id).get()]);
  if (!ride.exists) return null;
  return { ride: ride.data() as RideSummary, track: (track.data()?.points as TrackPoint[] | undefined) ?? [] };
}

/** Every ride's route, by ride id: for the heatmap and comparisons. */
export async function listTracks(uid: string): Promise<Record<string, TrackPoint[]>> {
  const snap = await tracksCol(uid).get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, (d.data().points as TrackPoint[] | undefined) ?? []]));
}
