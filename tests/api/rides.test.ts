import { beforeEach, describe, expect, test, vi } from "vitest";
import { doc, ids, json, params, reset, sample, signIn, state } from "./setup";

vi.mock("@/lib/firebase-admin", async () => (await import("./setup")).firebaseAdminMock());
vi.mock("@/lib/auth", async () => (await import("./setup")).authMock());

import { DELETE as deleteAll, GET, POST } from "@/app/api/rides/route";
import { DELETE as deleteOne, PATCH } from "@/app/api/rides/[id]/route";

beforeEach(reset);

const save = async (i: number) => POST(json("POST", sample(i)));

describe("/api/rides", () => {
  test("needs sign-in", async () => {
    expect((await GET()).status).toBe(401);
    expect((await save(0)).status).toBe(401);
    expect((await deleteAll()).status).toBe(401);
    expect(state.db.docs.size).toBe(0);
  });

  test("rejects bodies that aren't a ride with 400, not a crash", async () => {
    signIn();
    for (const body of ["null", "[]", "42", "not json", "{}", JSON.stringify({ summary: { id: "../../x", start: 1_700_000_000 } }), JSON.stringify({ summary: { ...sample(0).summary, start: 5 } })]) {
      expect((await POST(json("POST", body))).status, body).toBe(400);
    }
    expect(state.db.docs.size).toBe(0);
  });

  test("saves the summary, the route and its shape, and lists the id", async () => {
    signIn();
    const { summary, track } = sample(0);
    const res = await save(0);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: summary.id });
    expect(doc("alice", "rides", summary.id)).toEqual(summary);
    expect((doc("alice", "tracks", summary.id) as { points: unknown[] }).points).toHaveLength(track.length);
    const shape = doc("alice", "shapes", summary.id) as { cells: string[]; line: number[] };
    expect(shape.cells.length).toBeGreaterThan(0);
    expect(shape.line.length).toBeGreaterThan(2);
    expect(await (await GET()).json()).toEqual({ ids: [summary.id] });
  });

  test("cleans what the browser sends: out-of-range numbers and extra fields don't get stored", async () => {
    signIn();
    const { summary, track } = sample(0);
    await POST(json("POST", { summary: { ...summary, km: -5, maxKmh: 9999, admin: true, name: "set by import" }, track: [{ ...track[0], lat: 500, motorW: 1e9 }] }));
    const saved = doc("alice", "rides", summary.id)!;
    expect(saved.km).toBe(0);
    expect(saved.maxKmh).toBe(0);
    expect(saved).not.toHaveProperty("admin");
    expect(saved).not.toHaveProperty("name");
    const point = (doc("alice", "tracks", summary.id) as { points: { lat: number | null; motorW: number }[] }).points[0];
    expect(point.lat).toBeNull();
    expect(point.motorW).toBe(0);
  });

  test("saving a ride again replaces its figures but keeps its name and notes", async () => {
    signIn();
    const { summary, track } = sample(0);
    await save(0);
    await PATCH(json("PATCH", { name: "Sunday loop", notes: "muddy" }), params(summary.id));
    await POST(json("POST", { summary: { ...summary, km: summary.km + 1, modeS: { "2": 60 } }, track }));
    const saved = doc("alice", "rides", summary.id)!;
    expect(saved.name).toBe("Sunday loop");
    expect(saved.notes).toBe("muddy");
    expect(saved.km).toBe(summary.km + 1);
    // Maps are replaced whole, not merged with the old keys.
    expect(saved.modeS).toEqual({ "2": 60 });
  });

  test("delete all removes rides, routes and shapes, for this rider only", async () => {
    signIn("bob");
    await save(0);
    signIn("alice");
    await save(0);
    await save(1);
    expect((await deleteAll()).status).toBe(200);
    for (const col of ["rides", "tracks", "shapes"] as const) {
      expect(ids("alice", col)).toEqual([]);
      expect(ids("bob", col)).toHaveLength(1);
    }
  });
});

describe("/api/rides/[id]", () => {
  test("needs sign-in", async () => {
    expect((await PATCH(json("PATCH", { name: "x" }), params(sample(0).summary.id))).status).toBe(401);
    expect((await deleteOne(json("DELETE"), params(sample(0).summary.id))).status).toBe(401);
  });

  test("PATCH: bad bodies are 400, unknown rides 404", async () => {
    signIn();
    const { id } = sample(0).summary;
    await save(0);
    for (const body of ["null", "[]", "{}", "not json", JSON.stringify({ other: 1 })]) expect((await PATCH(json("PATCH", body), params(id))).status, body).toBe(400);
    expect((await PATCH(json("PATCH", { name: "x" }), params("not a ride id"))).status).toBe(404);
    expect((await PATCH(json("PATCH", { name: "x" }), params(sample(1).summary.id))).status).toBe(404);
    expect(doc("alice", "rides", id)).not.toHaveProperty("name");
  });

  test("PATCH trims and caps the name and notes", async () => {
    signIn();
    const { id } = sample(0).summary;
    await save(0);
    expect((await PATCH(json("PATCH", { name: `  ${"n".repeat(200)}  `, notes: "x".repeat(5000) }), params(id))).status).toBe(200);
    const saved = doc("alice", "rides", id)!;
    expect(saved.name).toBe("n".repeat(80));
    expect(saved.notes).toHaveLength(2000);
    // A name that isn't text clears it rather than storing something odd.
    await PATCH(json("PATCH", { name: { evil: true } }), params(id));
    expect(doc("alice", "rides", id)!.name).toBe("");
  });

  test("one rider can't rename or delete another's ride", async () => {
    signIn("bob");
    await save(0);
    const { id } = sample(0).summary;
    signIn("alice");
    expect((await PATCH(json("PATCH", { name: "mine now" }), params(id))).status).toBe(404);
    await deleteOne(json("DELETE"), params(id));
    expect(doc("bob", "rides", id)).not.toHaveProperty("name");
    expect(ids("bob", "tracks")).toEqual([id]);
  });

  test("DELETE removes the ride, its route and its shape", async () => {
    signIn();
    await save(0);
    await save(1);
    const { id } = sample(0).summary;
    expect((await deleteOne(json("DELETE"), params(id))).status).toBe(200);
    for (const col of ["rides", "tracks", "shapes"] as const) expect(ids("alice", col)).toEqual([sample(1).summary.id]);
    expect((await deleteOne(json("DELETE"), params("../x"))).status).toBe(404);
  });
});
