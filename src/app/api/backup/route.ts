import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { db, ridesCol, tracksCol } from "@/lib/firebase-admin";
import { getSettings, listRides } from "@/lib/data";
import { asObject, cleanSummary, cleanText, cleanTrack } from "@/lib/validate";
import { BACKUP_APP, BACKUP_VERSION, RESTORE_BATCH, type Backup } from "@/lib/backup";
import type { TrackPoint } from "@/lib/ride";

/** Everything in the account as one JSON download. */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const [settings, rides, tracks] = await Promise.all([getSettings(viewer.uid), listRides(viewer.uid), tracksCol(viewer.uid).get()]);
  const routes = new Map(tracks.docs.map((d) => [d.id, (d.data().points as TrackPoint[] | undefined) ?? []]));
  const backup: Backup = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    rides: rides.map((r) => ({ ...r, track: routes.get(r.id) ?? [] })),
  };
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="ride-stats-backup-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}

/**
 * Restores a batch of rides from a backup. Rides already in the account are
 * left alone unless `overwrite` is set. Settings are restored separately.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const body = asObject(await req.json().catch(() => null));
  if (!body || !Array.isArray(body.rides) || body.rides.length > RESTORE_BATCH) return NextResponse.json({ error: "Send up to 15 rides at a time" }, { status: 400 });
  const overwrite = body.overwrite === true;
  const rides = body.rides.map((raw) => {
    const o = asObject(raw);
    const summary = cleanSummary(o);
    if (!o || !summary) return null;
    return {
      summary: {
        ...summary,
        ...(typeof o.name === "string" ? { name: cleanText(o.name, 80) } : {}),
        ...(typeof o.notes === "string" ? { notes: cleanText(o.notes, 2000) } : {}),
      },
      track: cleanTrack(o.track),
    };
  });
  const valid = rides.filter((r): r is NonNullable<typeof r> => r !== null);
  const refs = valid.map((r) => ridesCol(viewer.uid).doc(r.summary.id));
  const existing = refs.length ? await db.getAll(...refs) : [];
  const batch = db.batch();
  let saved = 0;
  let skipped = 0;
  valid.forEach((r, i) => {
    if (existing[i]?.exists && !overwrite) {
      skipped++;
      return;
    }
    batch.set(refs[i], r.summary);
    batch.set(tracksCol(viewer.uid).doc(r.summary.id), { points: r.track });
    saved++;
  });
  if (saved) await batch.commit();
  return NextResponse.json({ ok: true, saved, skipped, invalid: rides.length - valid.length });
}
