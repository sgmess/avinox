import { test } from "node:test";
import assert from "node:assert/strict";
import { dayStart, fmtDuration, todayIn } from "./format.ts";

test("rounded durations carry minutes into the next hour", () => {
  assert.equal(fmtDuration(0), "0 min");
  assert.equal(fmtDuration(59 * 60 + 29), "59 min");
  assert.equal(fmtDuration(59 * 60 + 30), "1h 00");
  assert.equal(fmtDuration(3600), "1h 00");
  assert.equal(fmtDuration(7199), "2h 00");
});

test("a day starts at midnight in the chosen timezone, not the device's", () => {
  // London: GMT in winter, BST in summer.
  assert.equal(dayStart("2026-01-15", "Europe/London"), Date.UTC(2026, 0, 15) / 1000);
  assert.equal(dayStart("2026-07-15", "Europe/London"), Date.UTC(2026, 6, 14, 23) / 1000);
  assert.equal(dayStart("2026-07-15", "America/New_York"), Date.UTC(2026, 6, 15, 4) / 1000);
  assert.equal(dayStart("2026-07-15", "Asia/Kolkata"), Date.UTC(2026, 6, 14, 18, 30) / 1000);
  // The day the clocks go forward (01:00 → 02:00 in London) still starts at midnight GMT.
  assert.equal(dayStart("2026-03-29", "Europe/London"), Date.UTC(2026, 2, 29) / 1000);
  assert.equal(dayStart("not a date"), null);
  // 23:30 UTC on 6 Nov is already 7 Nov in Tokyo.
  assert.equal(todayIn("Asia/Tokyo", Date.UTC(2026, 10, 6, 23, 30)), "2026-11-07");
});
