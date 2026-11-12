import "server-only";
import { db, ridesCol, shapesCol, tracksCol, userDoc } from "./firebase-admin";
import type { RideSummary, TrackPoint } from "./ride";
import { readShape, shapeOf, type Shape } from "./heat";
import { cleanSettings, type Settings } from "./settings";

export async function getSettings(uid: string): Promise<Settings> {
  const snap = await userDoc(uid).get();
  return cleanSettings(snap.data()?.settings);
}

export async function listRides(uid: string): Promise<RideSummary[]> {
  const snap = await ridesCol(uid).orderBy("start", "desc").get();
  return snap.docs.map((d) => d.data() as RideSummary);
}

const points = (data: FirebaseFirestore.DocumentData | undefined) => (data?.points as TrackPoint[] | undefined) ?? [];

export async function getRide(uid: string, id: string): Promise<{ ride: RideSummary; track: TrackPoint[] } | null> {
  const [ride, track] = await Promise.all([ridesCol(uid).doc(id).get(), tracksCol(uid).doc(id).get()]);
  if (!ride.exists) return null;
  return { ride: ride.data() as RideSummary, track: points(track.data()) };
}

/** How many documents to read or write in one go. */
const CHUNK = 100;

/** The routes of these rides, by ride id. Reads only what's asked for. */
export async function getTracks(uid: string, ids: string[]): Promise<Record<string, TrackPoint[]>> {
  const out: Record<string, TrackPoint[]> = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const snaps = await db.getAll(...ids.slice(i, i + CHUNK).map((id) => tracksCol(uid).doc(id)));
    for (const s of snaps) out[s.id] = points(s.data());
  }
  return out;
}

/**
 * Every ride's shape (see heat.ts), by ride id: for the heatmap and for
 * finding rides on the same roads, without loading every full route. Rides
 * saved before shapes existed get theirs made here, once, from their route.
 */
export async function listShapes(uid: string, rideIds: string[]): Promise<Record<string, Shape>> {
  const snap = await shapesCol(uid).get();
  const out: Record<string, Shape> = {};
  for (const d of snap.docs) {
    const shape = readShape(d.data());
    if (shape) out[d.id] = shape;
  }
  const missing = rideIds.filter((id) => !out[id]);
  for (let i = 0; i < missing.length; i += CHUNK) {
    const ids = missing.slice(i, i + CHUNK);
    const tracks = await getTracks(uid, ids);
    const batch = db.batch();
    for (const id of ids) {
      out[id] = shapeOf(tracks[id] ?? []);
      batch.set(shapesCol(uid).doc(id), out[id]);
    }
    await batch.commit();
  }
  return out;
}
