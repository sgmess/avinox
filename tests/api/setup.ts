import { vi } from "vitest";
import { FakeFirestore } from "./fake-firestore";
import { demoRides } from "@/lib/demo";

/*
 * Shared by the route tests: the fake database, who's signed in, and the
 * Firebase Auth calls the session route makes. Each test file mocks
 * "@/lib/firebase-admin" and "@/lib/auth" with these (see mocks()).
 */

export const state = {
  db: new FakeFirestore(),
  viewer: null as { uid: string; email: string; emailVerified: boolean; name: string } | null,
  auth: {
    verifyIdToken: vi.fn(),
    createSessionCookie: vi.fn(),
    revokeRefreshTokens: vi.fn(),
  },
};

export function reset() {
  state.db = new FakeFirestore();
  state.viewer = null;
  for (const f of Object.values(state.auth)) f.mockReset();
}

export const signIn = (uid = "alice") => {
  state.viewer = { uid, email: `${uid}@example.com`, emailVerified: true, name: uid };
};

export const firebaseAdminMock = () => {
  const userDoc = (uid: string) => state.db.collection("riders").doc(uid);
  return {
    get db() {
      return state.db;
    },
    get adminAuth() {
      return state.auth;
    },
    userDoc,
    ridesCol: (uid: string) => userDoc(uid).collection("rides"),
    tracksCol: (uid: string) => userDoc(uid).collection("tracks"),
    shapesCol: (uid: string) => userDoc(uid).collection("shapes"),
  };
};

export const authMock = () => ({ SESSION_COOKIE: "__session", getViewer: async () => state.viewer });

export const json = (method: string, body?: unknown, url = "http://test.local/api") =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });

export const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Real summaries and routes (the demo's), to post as an import would. */
const demo = demoRides();
export const sample = (i: number) => ({ summary: demo.summaries[i], track: demo.tracks[demo.summaries[i].id] });
export const sampleCount = demo.summaries.length;

export const ids = (uid: string, col: "rides" | "tracks" | "shapes") => state.db.ids(`riders/${uid}/${col}`).sort();
export const doc = (uid: string, col: "rides" | "tracks" | "shapes", id: string) => state.db.docs.get(`riders/${uid}/${col}/${id}`);
