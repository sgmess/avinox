import { beforeEach, describe, expect, test, vi } from "vitest";
import { doc, ids, json, reset, sample, signIn, state } from "./setup";

vi.mock("@/lib/firebase-admin", async () => (await import("./setup")).firebaseAdminMock());
vi.mock("@/lib/auth", async () => (await import("./setup")).authMock());

import { POST as saveRide } from "@/app/api/rides/route";
import { getTracks, listRides, listShapes } from "@/lib/data";
import { shapeOf } from "@/lib/heat";

beforeEach(reset);

describe("shapes: what the heatmap and compare pages read instead of every full route", () => {
  test("rides saved before shapes existed get theirs made once, then no route is read again", async () => {
    signIn();
    for (let i = 0; i < 5; i++) await saveRide(json("POST", sample(i)));
    // As an account from before shapes: routes but no shapes.
    for (const id of ids("alice", "shapes")) state.db.docs.delete(`riders/alice/shapes/${id}`);
    const rideIds = (await listRides("alice")).map((r) => r.id);

    const first = await listShapes("alice", rideIds);
    expect(Object.keys(first).sort()).toEqual([...rideIds].sort());
    for (const id of rideIds) expect(first[id]).toEqual(shapeOf((doc("alice", "tracks", id) as { points: never[] }).points));
    expect(ids("alice", "shapes")).toHaveLength(5);

    state.db.reads = [];
    const second = await listShapes("alice", rideIds);
    expect(second).toEqual(first);
    expect(state.db.reads.filter((p) => p.includes("/tracks/"))).toEqual([]);
  });

  test("getTracks reads only the routes asked for", async () => {
    signIn();
    for (let i = 0; i < 4; i++) await saveRide(json("POST", sample(i)));
    state.db.reads = [];
    const want = [sample(1).summary.id, sample(3).summary.id];
    const tracks = await getTracks("alice", want);
    expect(Object.keys(tracks).sort()).toEqual([...want].sort());
    expect(state.db.reads.filter((p) => p.includes("/tracks/"))).toHaveLength(2);
    expect(await getTracks("alice", [])).toEqual({});
  });
});
