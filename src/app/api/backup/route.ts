import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { db, ridesCol, shapesCol, tracksCol } from "@/lib/firebase-admin";
import { getSettings, getTracks } from "@/lib/data";
import { shapeOf } from "@/lib/heat";
import { asObject, cleanSummary, cleanText, cleanTrack } from "@/lib/validate";
import { BACKUP_APP, BACKUP_VERSION, RESTORE_BATCH, type Backup } from "@/lib/backup";
import type { RideSummary } from "@/lib/ride";

/** Rides fetched, with their routes, per step of the download. */
const PAGE = 40;

/**
 * Everything in the account as one JSON download. Written out a page of rides
 * at a time, so a big account neither fills the server's memory nor hits the
 * size limit on a single response.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const uid = viewer.uid;
  const settings = await getSettings(uid);
  const head: Omit<Backup, "rides"> = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), settings };
  const encoder = new TextEncoder();
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let first = true;
  let done = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // {"app":…,"settings":…,"rides":[ … ]}
      controller.enqueue(encoder.encode(`${JSON.stringify(head).slice(0, -1)},"rides":[`));
    },
    async pull(controller) {
      if (done) return;
      try {
        const base = ridesCol(uid).orderBy("start", "desc").limit(PAGE);
        const page = await (last ? base.startAfter(last) : base).get();
        if (page.docs.length) {
          const tracks = await getTracks(uid, page.docs.map((d) => d.id));
          const rides = page.docs.map((d) => JSON.stringify({ ...(d.data() as RideSummary), track: tracks[d.id] ?? [] }));
          controller.enqueue(encoder.encode((first ? "" : ",") + rides.join(",")));
          first = false;
          last = page.docs[page.docs.length - 1];
        }
        if (page.docs.length < PAGE) {
          done = true;
          controller.enqueue(encoder.encode("]}"));
          controller.close();
        }
      } catch (e) {
        // Cut the download short, so a half-written file can't pass for a whole backup.
        console.error("[backup]", e);
        done = true;
        controller.error(e);
      }
    },
  });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(stream, {
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
    batch.set(shapesCol(viewer.uid).doc(r.summary.id), shapeOf(r.track));
    saved++;
  });
  if (saved) await batch.commit();
  return NextResponse.json({ ok: true, saved, skipped, invalid: rides.length - valid.length });
}
