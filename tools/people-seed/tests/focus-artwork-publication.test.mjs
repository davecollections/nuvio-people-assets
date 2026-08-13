import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const readJson = async (relativePath) => JSON.parse(
  await readFile(path.join(repositoryRoot, relativePath), "utf8")
);

test("production focus artwork covers every and only source-backed People identity", async () => {
  const [publication, legacyArtwork, manifest] = await Promise.all([
    readJson("data/people-base/focus-artwork-publication-v1.json"),
    readJson("data/people-base/legacy-artwork-manifest.json"),
    readJson("manifests/people.json")
  ]);
  assert.equal(publication.version, "people-static-colour-focus-publication-v1");
  assert.equal(publication.status, "owner-approved-production");
  assert.equal(publication.trackingIssue, 43);
  assert.equal(manifest.focusArtworkPreset.status, "production-approved");
  assert.deepEqual(manifest.focusArtworkPreset.excludedPersonIds, [8559, 76447]);

  const eligibleIds = legacyArtwork.records
    .filter((record) => !record.fallbackUsed)
    .map((record) => record.tmdbPersonId);
  const excludedIds = legacyArtwork.records
    .filter((record) => record.fallbackUsed)
    .map((record) => record.tmdbPersonId);
  assert.equal(eligibleIds.length, 1478);
  assert.deepEqual(excludedIds, [8559, 76447]);
  assert.equal(publication.catalogue.publishedPairs, eligibleIds.length);
  assert.deepEqual(
    publication.catalogue.excluded.map((record) => record.tmdbPersonId),
    excludedIds
  );
  assert.equal(manifest.assetCounts.focusPoster, eligibleIds.length);
  assert.equal(manifest.assetCounts.focusLandscape, eligibleIds.length);

  const eligibleSet = new Set(eligibleIds);
  let posterBytes = 0;
  let landscapeBytes = 0;
  for (const person of manifest.people) {
    const hasPoster = Boolean(person.assets.focusPoster);
    const hasLandscape = Boolean(person.assets.focusLandscape);
    assert.equal(hasPoster, eligibleSet.has(person.tmdbPersonId), `${person.tmdbPersonId}: focus poster eligibility mismatch`);
    assert.equal(hasLandscape, eligibleSet.has(person.tmdbPersonId), `${person.tmdbPersonId}: focus landscape eligibility mismatch`);
    if (!hasPoster) continue;
    assert.equal(person.assets.focusPoster.width, publication.preset.poster.width);
    assert.equal(person.assets.focusPoster.height, publication.preset.poster.height);
    assert.equal(person.assets.focusLandscape.width, publication.preset.landscape.width);
    assert.equal(person.assets.focusLandscape.height, publication.preset.landscape.height);
    posterBytes += person.assets.focusPoster.bytes;
    landscapeBytes += person.assets.focusLandscape.bytes;
  }
  assert.equal(posterBytes, publication.catalogue.posterBytes);
  assert.equal(landscapeBytes, publication.catalogue.landscapeBytes);
  assert.equal(posterBytes + landscapeBytes, publication.catalogue.totalBytes);
});
