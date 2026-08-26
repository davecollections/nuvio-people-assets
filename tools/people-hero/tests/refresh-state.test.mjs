import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRefreshState,
  buildRefreshStateRecord,
  compactHeroSelection,
  compareRefreshSelections,
  partitionRefreshCandidates,
  sortRefreshCandidates,
  validateRefreshState
} from "../src/refresh-state.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function credit(mediaId, poster = `/poster-${mediaId}.jpg`, backdrop = `/backdrop-${mediaId}.jpg`) {
  return { mediaType: "movie", mediaId, posterPath: poster, backdropPath: backdrop };
}

function selection(ids, overrides = {}) {
  return compactHeroSelection({
    outcome: "filmography",
    selectedCredits: ids.map((id) => credit(id)),
    fallbackProfiles: [],
    ...overrides
  });
}

test("refresh comparison ignores score-only ordering and one lower-salience replacement", () => {
  const baseline = selection(Array.from({ length: 15 }, (_, index) => index + 1));
  const reordered = { ...baseline, credits: [...baseline.credits].reverse() };
  assert.equal(compareRefreshSelections(baseline, reordered).action, "none");

  const oneReplacement = selection([1, 2, 3, 4, 5, 6, 7, 8, 99, 10, 11, 12, 13, 14, 15]);
  const comparison = compareRefreshSelections(baseline, oneReplacement);
  assert.equal(comparison.action, "none");
  assert.equal(comparison.metrics.materialChangeCount, 1);
});

test("refresh comparison stages a genuinely new top-eight credit", () => {
  const baseline = selection(Array.from({ length: 15 }, (_, index) => index + 1));
  const current = selection([99, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]);
  const comparison = compareRefreshSelections(baseline, current);
  assert.equal(comparison.action, "stage");
  assert.deepEqual(comparison.metrics.newTopEightCredits, ["movie:99"]);
  assert.ok(comparison.reasons.includes("new-credit-entered-top-eight"));
});

test("refresh comparison requires two filmography sources or three profile sources", () => {
  const baseline = selection(Array.from({ length: 15 }, (_, index) => index + 1));
  const changed = structuredClone(baseline);
  changed.credits[10][2] = "/changed-11.jpg";
  changed.credits[11][2] = "/changed-12.jpg";
  assert.equal(compareRefreshSelections(baseline, changed).action, "stage");

  const profiles = { outcome: "profile-only", credits: [], profiles: ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"] };
  const twoProfiles = { outcome: "profile-only", credits: [], profiles: ["/a.jpg", "/b.jpg", "/x.jpg", "/y.jpg"] };
  const threeProfiles = { outcome: "profile-only", credits: [], profiles: ["/a.jpg", "/x.jpg", "/y.jpg", "/z.jpg"] };
  assert.equal(compareRefreshSelections(profiles, twoProfiles).action, "none");
  assert.equal(compareRefreshSelections(profiles, threeProfiles).action, "stage");
});

test("outcome changes stage renderable heroes and retain published heroes on skip", () => {
  const filmography = selection(Array.from({ length: 15 }, (_, index) => index + 1));
  const sparse = compactHeroSelection({ outcome: "sparse-fallback", selectedCredits: [credit(1)], fallbackProfiles: [] });
  const skip = { outcome: "skip", credits: [], profiles: [] };
  assert.equal(compareRefreshSelections(sparse, filmography).action, "stage");
  assert.equal(compareRefreshSelections(filmography, skip).action, "attention");
  assert.equal(compareRefreshSelections(filmography, filmography, { force: true }).action, "stage");
  assert.equal(compareRefreshSelections(skip, skip, { force: true }).action, "attention");
});

test("refresh candidate ordering prioritises fallback upgrades, top eight, then material size", () => {
  const ordered = sortRefreshCandidates([
    { tmdbPersonId: 30, comparison: { reasons: ["two-selected-sources-changed"], metrics: { materialChangeCount: 8 } } },
    { tmdbPersonId: 20, comparison: { reasons: ["new-credit-entered-top-eight"], metrics: { materialChangeCount: 1 } } },
    { tmdbPersonId: 10, comparison: { reasons: ["outcome-changed:sparse-fallback->filmography"], metrics: { materialChangeCount: 0 } } }
  ]);
  assert.deepEqual(ordered.map((item) => item.tmdbPersonId), [10, 20, 30]);
});

test("refresh candidate overflow is capped after deterministic priority ordering", () => {
  const candidates = Array.from({ length: 35 }, (_, index) => ({
    tmdbPersonId: 100 + index,
    comparison: {
      reasons: index === 34 ? ["new-credit-entered-top-eight"] : ["two-selected-sources-changed"],
      metrics: { materialChangeCount: index % 4 }
    }
  }));
  const first = partitionRefreshCandidates(candidates, 30);
  const second = partitionRefreshCandidates([...candidates].reverse(), 30);
  assert.deepEqual(first, second);
  assert.equal(first.selected.length, 30);
  assert.equal(first.overflow.length, 5);
  assert.equal(first.selected[0].tmdbPersonId, 134);
  assert.deepEqual(new Set([...first.selected, ...first.overflow]).size, 35);
});

test("refresh state is complete, deterministic, and bound to manifest hero hashes", () => {
  const rawSelection = { outcome: "sparse-fallback", selectedCredits: [credit(1)], fallbackProfiles: [] };
  const record = buildRefreshStateRecord({
    tmdbPersonId: 31,
    publishedHeroSha256: HASH_A,
    sourceSnapshotSha256: HASH_B,
    selection: rawSelection
  });
  const state = buildRefreshState([record]);
  const registry = { people: [{ tmdbPersonId: 31, canonicalName: "Tom Hanks", categoryMembership: ["actor"] }] };
  const manifest = { people: [{ tmdbPersonId: 31, assets: { hero: { sha256: HASH_A } } }] };
  assert.equal(validateRefreshState({ state, registry, manifest }), true);
  const drifted = structuredClone(state);
  drifted.records[0].publishedHeroSha256 = HASH_B;
  assert.throws(() => validateRefreshState({ state: drifted, registry, manifest }), /differs from the manifest/u);
});
