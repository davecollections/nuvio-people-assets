import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { deriveLayoutSeed, isPathInside } from "../src/preflight.mjs";

test("layout seeds are stable and identity-specific", () => {
  const presetId = "people-t2-perspective-v2";
  const tomFirst = deriveLayoutSeed({ presetId, tmdbPersonId: 31, sourceKeys: ["movie:1"] });
  const tomSecond = deriveLayoutSeed({ presetId, tmdbPersonId: 31, sourceKeys: ["movie:1"] });
  const blake = deriveLayoutSeed({ presetId, tmdbPersonId: 1927 });

  assert.equal(tomFirst, tomSecond);
  assert.notEqual(tomFirst, blake);
  assert.notEqual(tomFirst, deriveLayoutSeed({ presetId, tmdbPersonId: 31, sourceKeys: ["movie:2"] }));
  assert.ok(Number.isInteger(tomFirst) && tomFirst > 0);
});

test("path containment rejects siblings and accepts descendants", () => {
  const root = path.resolve("C:/example/people-hero");
  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, path.join(root, "staging", "hero.webp")), true);
  assert.equal(isPathInside(root, path.resolve(root, "..", "nuvio-people-assets")), false);
});
