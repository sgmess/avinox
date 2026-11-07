import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { ridesCol, tracksCol, db } from "@/lib/firebase-admin";
import { asObject, cleanSummary, cleanTrack } from "@/lib/validate";

/** The ids already saved, so the import can skip rides it has seen. */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const refs = await ridesCol(viewer.uid).listDocuments();
  return NextResponse.json({ ids: refs.map((r) => r.id) });
}

/** Saves one ride: its summary and its thinned track. Saving it again replaces it but keeps its name and notes. */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const body = asObject(await req.json().catch(() => null));
  const cleaned = cleanSummary(body?.summary);
  if (!cleaned) return NextResponse.json({ error: "That ride couldn't be read" }, { status: 400 });
  const summary = cleaned;
  const ref = ridesCol(viewer.uid).doc(summary.id);
  const track = cleanTrack(body?.track);
  const batch = db.batch();
  // Replace computed maps as whole fields, retaining the stored name and notes.
  batch.set(ref, summary, { mergeFields: Object.keys(summary) });
  batch.set(tracksCol(viewer.uid).doc(summary.id), { points: track });
  await batch.commit();
  return NextResponse.json({ ok: true, id: summary.id });
}

/** Deletes every ride. */
export async function DELETE() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  await Promise.all([db.recursiveDelete(ridesCol(viewer.uid)), db.recursiveDelete(tracksCol(viewer.uid))]);
  return NextResponse.json({ ok: true });
}
