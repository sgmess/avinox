import { beforeEach, describe, expect, test, vi } from "vitest";
import { json, reset, signIn, state } from "./setup";

vi.mock("@/lib/firebase-admin", async () => (await import("./setup")).firebaseAdminMock());
vi.mock("@/lib/auth", async () => (await import("./setup")).authMock());

import { PUT } from "@/app/api/settings/route";
import { DELETE, POST } from "@/app/api/session/route";
import { DEFAULT_SETTINGS } from "@/lib/settings";

beforeEach(reset);

const stored = (uid = "alice") => state.db.docs.get(`riders/${uid}`) as { settings: typeof DEFAULT_SETTINGS; email: string } | undefined;

describe("/api/settings", () => {
  test("needs sign-in", async () => {
    expect((await PUT(json("PUT", DEFAULT_SETTINGS))).status).toBe(401);
    expect(state.db.docs.size).toBe(0);
  });

  test("stores cleaned settings and returns them", async () => {
    signIn();
    const res = await PUT(json("PUT", { units: "km", batteryWh: 99999, bikeName: "  Amflow  ", modeNames: { "1": " Eco+ ", bad: "x" }, timeZone: "Mars/Olympus", pricePerKwh: -1, currency: "€", extra: 1 }));
    expect(res.status).toBe(200);
    const want = { ...DEFAULT_SETTINGS, units: "km", bikeName: "Amflow", modeNames: { "1": "Eco+" }, currency: "€" };
    expect((await res.json()).settings).toEqual(want);
    expect(stored()).toEqual({ settings: want, email: "alice@example.com" });
  });

  test("a junk body saves the defaults rather than failing", async () => {
    signIn();
    for (const body of ["null", "not json", "[]"]) expect((await PUT(json("PUT", body))).status, body).toBe(200);
    expect(stored()!.settings).toEqual(DEFAULT_SETTINGS);
  });

  test("clearing a mode name removes it (settings are replaced, not merged)", async () => {
    signIn();
    await PUT(json("PUT", { ...DEFAULT_SETTINGS, modeNames: { "1": "Gentle", "3": "Rocket" }, batteryHistory: [{ until: 1_700_000_000, wh: 600 }] }));
    await PUT(json("PUT", { ...DEFAULT_SETTINGS, modeNames: { "3": "Rocket" } }));
    expect(stored()!.settings.modeNames).toEqual({ "3": "Rocket" });
    expect(stored()!.settings.batteryHistory).toEqual([]);
  });

  test("saving settings leaves the rider's rides alone", async () => {
    signIn();
    state.db.docs.set("riders/alice/rides/r1", { id: "r1" });
    await PUT(json("PUT", DEFAULT_SETTINGS));
    expect(state.db.docs.get("riders/alice/rides/r1")).toEqual({ id: "r1" });
  });
});

describe("/api/session", () => {
  const now = () => Math.floor(Date.now() / 1000);

  test("POST: a missing or non-text token is 400, whatever the body", async () => {
    for (const body of ["null", "[]", "{}", "not json", JSON.stringify({ idToken: 5 }), JSON.stringify({ idToken: "" })]) {
      expect((await POST(json("POST", body))).status, body).toBe(400);
    }
    expect(state.auth.verifyIdToken).not.toHaveBeenCalled();
  });

  test("POST: a token Firebase rejects, or a sign-in over five minutes old, is 401 with no cookie", async () => {
    state.auth.verifyIdToken.mockRejectedValueOnce(new Error("bad token"));
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const bad = await POST(json("POST", { idToken: "x" }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();

    state.auth.verifyIdToken.mockResolvedValueOnce({ uid: "alice", auth_time: now() - 600 });
    const stale = await POST(json("POST", { idToken: "x" }));
    expect(stale.status).toBe(401);
    expect(stale.headers.get("set-cookie")).toBeNull();
    expect(state.auth.createSessionCookie).not.toHaveBeenCalled();
  });

  test("POST: a fresh sign-in gets an httpOnly session cookie", async () => {
    state.auth.verifyIdToken.mockResolvedValueOnce({ uid: "alice", auth_time: now() });
    state.auth.createSessionCookie.mockResolvedValueOnce("session-value");
    const res = await POST(json("POST", { idToken: "good" }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("__session=session-value");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  test("DELETE clears the cookie; only ?everywhere=1 revokes the rider's other sessions", async () => {
    signIn();
    const res = await DELETE(json("DELETE"));
    expect(res.headers.get("set-cookie")).toMatch(/__session=;.*Max-Age=0/i);
    expect(state.auth.revokeRefreshTokens).not.toHaveBeenCalled();

    await DELETE(json("DELETE", undefined, "http://test.local/api/session?everywhere=1"));
    expect(state.auth.revokeRefreshTokens).toHaveBeenCalledWith("alice");

    // Signed out already: nothing to revoke, still clears the cookie.
    state.viewer = null;
    state.auth.revokeRefreshTokens.mockClear();
    const again = await DELETE(json("DELETE", undefined, "http://test.local/api/session?everywhere=1"));
    expect(again.status).toBe(200);
    expect(state.auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});
