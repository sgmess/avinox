import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDuration } from "./format.ts";

test("rounded durations carry minutes into the next hour", () => {
  assert.equal(fmtDuration(0), "0 min");
  assert.equal(fmtDuration(59 * 60 + 29), "59 min");
  assert.equal(fmtDuration(59 * 60 + 30), "1h 00");
  assert.equal(fmtDuration(3600), "1h 00");
  assert.equal(fmtDuration(7199), "2h 00");
});
