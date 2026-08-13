import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (relativePath) => JSON.parse(
  await readFile(path.join(repositoryRoot, relativePath), "utf8")
);

test("the controlled focus-artwork proof is identity, source, and output hash bound", async () => {
  const [proof, legacyArtwork, currentManifest] = await Promise.all([
    readJson("data/people-base/focus-artwork-proof-v1.json"),
    readJson("data/people-base/legacy-artwork-manifest.json"),
    readJson("manifests/people.json")
  ]);
  assert.equal(proof.version, "people-static-colour-focus-proof-v1");
  assert.equal(proof.status, "owner-approved-hosted-proof");
  assert.equal(proof.trackingIssue, 41);
  assert.equal(proof.recordCount, proof.records.length);
  assert.equal(proof.recordCount, 10);
  assert.deepEqual(
    proof.records.map((record) => record.tmdbPersonId),
    [...proof.records].map((record) => record.tmdbPersonId).sort((left, right) => left - right)
  );

  const legacyById = new Map(legacyArtwork.records.map((record) => [record.tmdbPersonId, record]));
  const currentById = new Map(currentManifest.people.map((record) => [record.tmdbPersonId, record]));
  for (const record of proof.records) {
    const legacy = legacyById.get(record.tmdbPersonId);
    const current = currentById.get(record.tmdbPersonId);
    assert.equal(record.canonicalName, current.canonicalName);
    assert.equal(record.sourceSha256, legacy.sourceHash);
    assert.equal(record.monochromePosterSha256, current.assets.poster.sha256);
    assert.equal(record.monochromeLandscapeSha256, current.assets.landscape.sha256);
    assert.notEqual(record.focusPosterSha256, record.monochromePosterSha256);
    assert.notEqual(record.focusLandscapeSha256, record.monochromeLandscapeSha256);

    const [poster, landscape] = await Promise.all([
      readFile(path.join(repositoryRoot, "assets", "people", String(record.tmdbPersonId), "focus-poster.webp")),
      readFile(path.join(repositoryRoot, "assets", "people", String(record.tmdbPersonId), "focus-landscape.webp"))
    ]);
    assert.equal(sha256(poster), record.focusPosterSha256);
    assert.equal(sha256(landscape), record.focusLandscapeSha256);
  }
});
