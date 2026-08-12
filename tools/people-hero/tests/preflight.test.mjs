import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { deriveLayoutSeed, isPathInside, validateCreditOverrides } from "../src/preflight.mjs";

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

test("credit override validation requires unique, explained media blocks", () => {
  const valid = {
    schemaVersion: 1,
    oneEpisodeTvRoles: [],
    blockedMedia: [{ mediaType: "movie", mediaId: 1687093, reason: "owner-blocked" }],
    creativeCrewCredits: [{
      personId: 9339,
      mediaType: "movie",
      mediaId: 752,
      jobs: ["Producer", "Screenplay"],
      reason: "owner-approved"
    }]
  };
  assert.equal(validateCreditOverrides(valid), valid);
  assert.throws(() => validateCreditOverrides({ ...valid, blockedMedia: []
    .concat(valid.blockedMedia, valid.blockedMedia) }), /Duplicate blocked-media override/u);
  assert.throws(() => validateCreditOverrides({ ...valid, blockedMedia: [{ mediaType: "movie", mediaId: 1, reason: "" }] }),
    /Invalid blocked-media override record/u);
  assert.throws(() => validateCreditOverrides({ ...valid, creativeCrewCredits: []
    .concat(valid.creativeCrewCredits, valid.creativeCrewCredits) }), /Duplicate creative-crew credit override/u);
  assert.throws(() => validateCreditOverrides({ ...valid, creativeCrewCredits: [{
    ...valid.creativeCrewCredits[0], jobs: ["Executive Producer"]
  }] }), /Invalid creative-crew credit override record/u);
});
