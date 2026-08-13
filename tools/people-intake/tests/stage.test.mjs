import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPreflight } from "../../people-hero/src/preflight.mjs";
import { renderPeopleArtwork } from "../../people-seed/src/people-artwork/renderer.mjs";
import {
  assertNewPersonWorkPath,
  candidateOutputDefinitions,
  parseNewPersonStageArguments,
  selectBaseProfile,
  suggestCategoryMembership
} from "../src/stage.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("new People stage input requires exactly one positive ID", () => {
  assert.equal(parseNewPersonStageArguments(["--person-id", "9001"]).personId, 9001);
  assert.throws(() => parseNewPersonStageArguments([]), /exactly one/u);
  assert.throws(() => parseNewPersonStageArguments(["--person-id", "0"]), /Invalid/u);
  assert.throws(() => parseNewPersonStageArguments(["--person-id", "9001", "--unexpected"]), /Unknown/u);
});

test("base profile selection prefers TMDB default then deterministic portrait fallback", () => {
  const profiles = [
    { file_path: "/lower.jpg", width: 1000, height: 1500, vote_count: 5, vote_average: 8 },
    { file_path: "/higher.jpg", width: 800, height: 1200, vote_count: 20, vote_average: 7 },
    { file_path: "/landscape.jpg", width: 1600, height: 900, vote_count: 100, vote_average: 10 }
  ];
  assert.equal(selectBaseProfile({ profile_path: "/lower.jpg", images: { profiles } }).filePath, "/lower.jpg");
  assert.equal(selectBaseProfile({ profile_path: null, images: { profiles } }).filePath, "/higher.jpg");
  assert.equal(selectBaseProfile({ profile_path: null, images: { profiles: [] } }), null);
});

test("category suggestion remains provisional and uses stable credit evidence", () => {
  const directing = suggestCategoryMembership({
    known_for_department: "Directing",
    combined_credits: { cast: [{ id: 1, media_type: "movie" }], crew: [{ id: 2, media_type: "movie", job: "Director" }] }
  });
  assert.deepEqual(directing.categoryMembership, ["director"]);
  assert.equal(directing.status, "owner-review-required");
  assert.equal(directing.exactDirectorCreditCount, 1);
  const acting = suggestCategoryMembership({ known_for_department: "Acting", combined_credits: { cast: [], crew: [] } });
  assert.deepEqual(acting.categoryMembership, ["actor"]);
});

test("complete and fallback candidates have explicit paired output contracts", () => {
  assert.deepEqual(
    candidateOutputDefinitions({ hasProfile: true, heroStatus: "staging-only-needs-owner-review" })
      .map(([key]) => key),
    ["poster", "landscape", "titleLogo", "focusPoster", "focusLandscape", "hero"]
  );
  assert.deepEqual(
    candidateOutputDefinitions({ hasProfile: false, heroStatus: "skipped" }).map(([key]) => key),
    ["poster", "landscape", "titleLogo"]
  );
});

test("new People output paths fail closed outside the ignored intake workspace", () => {
  assert.throws(() => assertNewPersonWorkPath(path.join(repositoryRoot, "assets", "people", "9000001")), /staging output/u);
  assert.doesNotThrow(() => assertNewPersonWorkPath(path.join(repositoryRoot, "tools", "people-intake", ".work", "attempt-fixture")));
});

test("hero preflight accepts an internal staged candidate but the public CLI remains registry-bound", async () => {
  const personCandidate = {
    stableKey: "person:9000001",
    tmdbPersonId: 9000001,
    canonicalName: "Fixture Person",
    categoryMembership: ["actor"]
  };
  const result = await buildPreflight({ personId: 9000001, personCandidate });
  assert.equal(result.identityOrigin, "staged-unregistered-candidate");
  assert.deepEqual(result.person, personCandidate);
  await assert.rejects(() => buildPreflight({ personId: 9000001 }), /not present/u);
});

test("renderer exposes locked monochrome and colour treatments without weakening quality bounds", async () => {
  await assert.rejects(() => renderPeopleArtwork({ people: [], portraitTreatment: "sepia" }), /Unsupported/u);
  await assert.rejects(() => renderPeopleArtwork({ people: [], outputQuality: 0 }), /integer from 1 to 100/u);
});

test("new People intake source contains no credential or permanent publication path", async () => {
  const source = await readFile(path.join(repositoryRoot, "tools", "people-intake", "src", "stage.mjs"), "utf8");
  assert.doesNotMatch(source, /TMDB_BEARER_TOKEN|api_key|api\.themoviedb\.org/iu);
  assert.doesNotMatch(source, /git\s+(add|commit|push)|npm\s+run\s+manifest/iu);
  assert.match(source, /const workRoot = path\.join\(toolRoot, ["']\.work["']\)/u);
});
