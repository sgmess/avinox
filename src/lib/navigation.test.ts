import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "./navigation.ts";

test("login redirects retain local paths, queries and fragments", () => {
  assert.equal(safeNext("/rides/123?view=map#route"), "/rides/123?view=map#route");
  assert.equal(safeNext("/settings"), "/settings");
});

test("login redirects reject external and malformed destinations", () => {
  for (const value of [undefined, null, 12, ["/settings"], "https://example.com", "//example.com", "/\\example.com", "/\t/example.com", "/\n/example.com", "/ settings", "/a/..//example.com", "/%2e//example.com", "javascript:alert(1)"]) {
    assert.equal(safeNext(value), "/", String(value));
  }
});
