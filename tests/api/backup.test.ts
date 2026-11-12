import { beforeEach, describe, expect, test, vi } from "vitest";
import { doc, ids, json, reset, sample, sampleCount, signIn, state } from "./setup";

vi.mock("@/lib/firebase-admin", async () => (await import("./setup")).firebaseAdminMock());
vi.mock("@/lib/auth", async () => (await import("./setup")).authMock());

import { GET, POST } from "@/app/api/backup/route";
import { POST as saveRide } from "@/app/api/rides/route";
import { PATCH } from "@/app/api/rides/[id]/route";
import { PUT as saveSettings } from "@/app/api/settings/route";
import { RESTORE_BATCH, readBackup, type Backup } from "@/lib/backup";
import { rideConfidence } from "@/lib/confidence";
import { DEFAULT_SETTINGS } from "@/lib/settings";

beforeEach(reset);

const restore = (rides: unknown[], overwrite = false) => POST(json("POST", { rides, overwrite }));
const backupRide = (i: number) => ({ ...sample(i).summary, track: sample(i).track });

describe("/api/backup", () => {
  test("needs sign-in", async () => {
    expect((await GET()).status).toBe(401);
    expect((await restore([backupRide(0)])).status).toBe(401);
  });

  test("the download is one valid backup with every ride, across several pages, and restores into another account", async () => {
    signIn("alice");
    const count = Math.min(sampleCount, 95);
    for (let i = 0; i < count; i++) await saveRide(json("POST", sample(i)));
    await saveSettings(json("PUT", { ...DEFAULT_SETTINGS, bikeName: "Amflow", units: "km" }));
    await PATCH(json("PATCH", { name: "Named", notes: "with notes" }), { params: Promise.resolve({ id: sample(3).summary.id }) });

    const res = await GET();
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="ride-stats-backup-\d{4}-\d\d-\d\d\.json"/);
    const read = readBackup(JSON.parse(await res.text()));
    expect(read.ok).toBe(true);
    const backup = (read as { backup: Backup }).backup;
    expect(backup.settings.bikeName).toBe("Amflow");
    expect(backup.rides).toHaveLength(count);
    expect(new Set(backup.rides.map((r) => r.id)).size).toBe(count);
    // Newest first, each with its route.
    expect(backup.rides.map((r) => r.start)).toEqual([...backup.rides.map((r) => r.start)].sort((a, b) => b - a));
    expect(backup.rides.every((r) => r.track.length > 0)).toBe(true);
    expect(backup.rides.find((r) => r.id === sample(3).summary.id)).toMatchObject({ name: "Named", notes: "with notes" });

    signIn("bob");
    for (let i = 0; i < backup.rides.length; i += RESTORE_BATCH) {
      const out = await (await restore(backup.rides.slice(i, i + RESTORE_BATCH))).json();
      expect(out.invalid).toBe(0);
    }
    for (const col of ["rides", "tracks", "shapes"] as const) expect(ids("bob", col)).toEqual(ids("alice", col));
    for (const id of ids("alice", "rides")) {
      expect(doc("bob", "rides", id)).toEqual(doc("alice", "rides", id));
      expect(doc("bob", "tracks", id)).toEqual(doc("alice", "tracks", id));
    }
  });

  test("an empty account downloads an empty, valid backup", async () => {
    signIn();
    const backup = JSON.parse(await (await GET()).text());
    expect(readBackup(backup).ok).toBe(true);
    expect(backup.rides).toEqual([]);
    expect(backup.settings).toEqual(DEFAULT_SETTINGS);
  });

  test("restore: bad requests are 400", async () => {
    signIn();
    for (const body of ["null", "[]", "{}", "not json", JSON.stringify({ rides: "x" }), JSON.stringify({ rides: Array.from({ length: RESTORE_BATCH + 1 }, () => backupRide(0)) })]) {
      expect((await POST(json("POST", body))).status, body.slice(0, 30)).toBe(400);
    }
    expect(state.db.docs.size).toBe(0);
  });

  test("restore keeps rides already here unless told to replace them, and counts what it couldn't read", async () => {
    signIn();
    await saveRide(json("POST", sample(0)));
    await PATCH(json("PATCH", { name: "Mine" }), { params: Promise.resolve({ id: sample(0).summary.id }) });
    const theirs = { ...backupRide(0), name: "From backup" };

    expect(await (await restore([theirs, backupRide(1), null, { id: "nonsense" }])).json()).toEqual({ ok: true, saved: 1, skipped: 1, invalid: 2 });
    expect(doc("alice", "rides", sample(0).summary.id)!.name).toBe("Mine");
    expect(ids("alice", "shapes")).toHaveLength(2);

    expect(await (await restore([theirs], true)).json()).toEqual({ ok: true, saved: 1, skipped: 0, invalid: 0 });
    expect(doc("alice", "rides", sample(0).summary.id)!.name).toBe("From backup");
  });

  test("a ride from before the detailed stats restores without them, so it's still 'not checked' rather than full of zeros", async () => {
    signIn();
    const old: Record<string, unknown> = backupRide(0);
    for (const k of ["observedS", "unknownS", "duplicates", "badFrames", "riderWAvg", "motorWAvg", "cadenceAvg", "wattZoneS", "torqueZoneS", "checksumsVerified"]) delete old[k];
    await restore([old]);
    const saved = doc("alice", "rides", sample(0).summary.id)!;
    expect(saved).not.toHaveProperty("observedS");
    expect(saved).not.toHaveProperty("wattZoneS");
    expect(rideConfidence(saved as never).level).toBe("unknown");
  });
});
