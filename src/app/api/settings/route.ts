import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { userDoc } from "@/lib/firebase-admin";
import { cleanSettings } from "@/lib/settings";

export async function PUT(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const settings = cleanSettings(await req.json().catch(() => ({})));
  // Replace settings whole. With { merge: true } Firestore merges maps key by key, so a
  // mode name the rider cleared (a key no longer sent) would stay and come back.
  await userDoc(viewer.uid).set({ settings, email: viewer.email }, { mergeFields: ["settings", "email"] });
  return NextResponse.json({ ok: true, settings });
}
