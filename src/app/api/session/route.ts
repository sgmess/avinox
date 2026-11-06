import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { SESSION_COOKIE, getViewer } from "@/lib/auth";
import { asObject } from "@/lib/validate";

const FIVE_DAYS = 5 * 86_400_000;

// Swaps a fresh Firebase ID token for an httpOnly session cookie.
export async function POST(req: Request) {
  const body = asObject(await req.json().catch(() => null));
  const idToken = body?.idToken;
  if (typeof idToken !== "string" || !idToken) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) {
      return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    }
    const session = await adminAuth.createSessionCookie(idToken, { expiresIn: FIVE_DAYS });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: FIVE_DAYS / 1000,
    });
    return res;
  } catch (e) {
    console.error("[session]", e);
    return NextResponse.json({ error: "Couldn't sign you in" }, { status: 401 });
  }
}

/**
 * Signs out. With ?everywhere=1 it also revokes every session the rider has,
 * on any device: Firebase can't revoke just one, so a copied cookie stays
 * valid until it expires unless this is used.
 */
export async function DELETE(req: Request) {
  if (new URL(req.url).searchParams.get("everywhere") === "1") {
    const viewer = await getViewer();
    if (viewer) await adminAuth.revokeRefreshTokens(viewer.uid);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
