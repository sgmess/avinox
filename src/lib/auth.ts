import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth } from "./firebase-admin";

export const SESSION_COOKIE = "__session";

export type Viewer = { uid: string; email: string; emailVerified: boolean; name: string };

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const claims = await adminAuth.verifySessionCookie(cookie, true);
    // As at sign-in: a verification link clicked since then shows from the next sign-in.
    // (Asking Firebase on every request cost a network call per page and API call.)
    return {
      uid: claims.uid,
      email: (claims.email ?? "").toLowerCase(),
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === "string" && claims.name ? claims.name : "",
    };
  } catch {
    return null;
  }
});

export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}
