import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { ridesCol, shapesCol, tracksCol } from "@/lib/firebase-admin";
import { RIDE_ID, asObject, cleanText } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

/** Renames a ride or changes its notes. */
export async function PATCH(req: Request, { params }: Ctx) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await params;
  if (!RIDE_ID.test(id)) return NextResponse.json({ error: "No such ride" }, { status: 404 });
  const body = asObject(await req.json().catch(() => null));
  const update: Record<string, string> = {};
  if (body?.name !== undefined) update.name = cleanText(body.name, 80);
  if (body?.notes !== undefined) update.notes = cleanText(body.notes, 2000);
  if (!Object.keys(update).length) return NextResponse.json({ error: "Send a name or notes" }, { status: 400 });
  const ref = ridesCol(viewer.uid).doc(id);
  if (!(await ref.get()).exists) return NextResponse.json({ error: "No such ride" }, { status: 404 });
  await ref.update(update);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await params;
  if (!RIDE_ID.test(id)) return NextResponse.json({ error: "No such ride" }, { status: 404 });
  await Promise.all([ridesCol(viewer.uid).doc(id).delete(), tracksCol(viewer.uid).doc(id).delete(), shapesCol(viewer.uid).doc(id).delete()]);
  return NextResponse.json({ ok: true });
}
