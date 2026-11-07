import { test } from "node:test";
import assert from "node:assert/strict";
import { rideConfidence } from "./confidence.ts";
import { demoRides } from "./demo.ts";
import type { RideSummary } from "./ride.ts";

const base: RideSummary = { ...demoRides().summaries[0], observedS: 3600, unknownS: 0, badFrames: 0, checksumsVerified: true, gpsShare: 1, altitudeShare: 1, batteryStart: 90, batteryEnd: 60 };

test("a full, clean recording is high confidence", () => {
  assert.deepEqual(rideConfidence(base), { level: "high", reasons: [] });
});

test("gaps lower confidence by how much of the ride they cover", () => {
  assert.equal(rideConfidence({ ...base, unknownS: 60 }).level, "high");
  assert.equal(rideConfidence({ ...base, unknownS: 600 }).level, "fair");
  assert.equal(rideConfidence({ ...base, unknownS: 3600 }).level, "low");
  assert.match(rideConfidence({ ...base, unknownS: 600 }).reasons[0], /10 min with no readings \(14% of the ride\)/);
});

test("damaged readings, unverified checksums and missing sensors", () => {
  assert.equal(rideConfidence({ ...base, badFrames: 10 }).level, "high");
  assert.equal(rideConfidence({ ...base, badFrames: 200 }).level, "fair");
  assert.equal(rideConfidence({ ...base, badFrames: 2000 }).level, "low");
  const unverified = rideConfidence({ ...base, checksumsVerified: false, badFrames: 1 });
  assert.equal(unverified.level, "low");
  assert.equal(unverified.reasons.length, 1);
  assert.equal(rideConfidence({ ...base, batteryStart: null }).level, "fair");
  assert.equal(rideConfidence({ ...base, gpsShare: 0 }).level, "fair");
  assert.equal(rideConfidence({ ...base, altitudeShare: 0.2 }).level, "fair");
  // Low keeps the fair reasons too, so the page lists everything.
  assert.equal(rideConfidence({ ...base, unknownS: 3600, gpsShare: 0 }).reasons.length, 2);
});

test("rides imported before the checks are 'not checked', and sensors not yet recorded aren't held against a ride", () => {
  assert.equal(rideConfidence({ ...base, observedS: undefined }).level, "unknown");
  assert.equal(rideConfidence({ ...base, gpsShare: undefined, altitudeShare: undefined }).level, "high");
});
