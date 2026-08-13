import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertSafeOutputDirectory } from "../src/people-artwork/renderer.mjs";
import { selectSourceCacheCandidates } from "../src/people-artwork/source-resolution.mjs";
import { loadTitleLogoConfiguration, prepareTitleLogoRenderer, renderTitleLogo } from "../src/people-artwork/title-logo.mjs";
import { applyTitleLogoOutputOverride, loadTitleLogoOutputOverrides } from "../src/people-artwork/title-logo-output-overrides.mjs";
import { parseConsolidationArguments } from "../src/consolidate-source-caches.mjs";
import { validateAgainstSchema } from "../src/schema-validator.mjs";
import { baseArtworkAttemptName, parseBaseArtworkArguments, stageBaseArtwork, validateBaseArtworkInput } from "../src/stage-base-artwork.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8"));

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

test("migrated registry, legacy base artwork, and approved v2 title logos cover the canonical 1480 identities", async () => {
  const [canonical, registry, artwork, presentation, current, migration, publication] = await Promise.all([
    readJson("data/people.json"),
    readJson("data/people-base/people-registry.json"),
    readJson("data/people-base/legacy-artwork-manifest.json"),
    readJson("data/people-base/legacy-presentation-manifest.json"),
    readJson("manifests/people.json"),
    readJson("data/people-base/migration-record.json"),
    readJson("data/people-base/title-logo-v2-publication.json"),
  ]);
  assert.equal(registry.recordCount, 1480);
  assert.equal(artwork.recordCount, 1480);
  assert.equal(presentation.recordCount, 1480);
  assert.equal(publication.recordCount, 1480);
  const canonicalById = new Map(canonical.people.map((person) => [person.tmdbPersonId, person]));
  const currentById = new Map(current.people.map((person) => [person.tmdbPersonId, person]));
  const presentationById = new Map(presentation.records.map((record) => [record.tmdbPersonId, record]));
  const publicationById = new Map(publication.records.map((record) => [record.tmdbPersonId, record]));
  const titleDrift = [];
  for (const person of registry.records) {
    const canonicalPerson = canonicalById.get(person.tmdbPersonId);
    const currentPerson = currentById.get(person.tmdbPersonId);
    const legacyTitle = presentationById.get(person.tmdbPersonId);
    const publishedTitle = publicationById.get(person.tmdbPersonId);
    assert.equal(person.canonicalName, canonicalPerson.canonicalName);
    assert.deepEqual(person.categoryMembership, canonicalPerson.categoryMembership);
    const legacyArtwork = artwork.records.find((record) => record.tmdbPersonId === person.tmdbPersonId);
    assert.equal(legacyArtwork.posterHash, currentPerson.assets.poster.sha256);
    assert.equal(legacyArtwork.landscapeHash, currentPerson.assets.landscape.sha256);
    assert.equal(publishedTitle.stableKey, person.stableKey);
    assert.equal(publishedTitle.canonicalName, person.canonicalName);
    assert.equal(publishedTitle.sha256, currentPerson.assets.titleLogo.sha256);
    assert.equal(publishedTitle.byteCount, currentPerson.assets.titleLogo.bytes);
    assert.equal(currentPerson.assets.titleLogo.width, publication.output.width);
    assert.equal(currentPerson.assets.titleLogo.height, publication.output.height);
    assert.equal(currentPerson.assets.titleLogo.format, publication.output.format);
    if (legacyTitle.titleLogoSha256 !== currentPerson.assets.titleLogo.sha256) titleDrift.push(person.tmdbPersonId);
  }
  assert.deepEqual(titleDrift, registry.records.map((record) => record.tmdbPersonId), "every owner-approved v2 title logo must supersede its legacy snapshot");
  const outputOverrides = await readJson("data/people-base/title-logo-output-overrides.json");
  assert.deepEqual(outputOverrides.records.map((record) => record.tmdbPersonId), [31], "the historical Tom Hanks tight-crop override remains preserved as legacy reproduction evidence");
  assert.equal(migration.localSourceArchive.approvedSourceCount + migration.localSourceArchive.fallbackCount, 1480);
  assert.equal(migration.localSourceArchive.missingCount, 0);
  assert.equal(migration.proofs.every((proof) => proof.matchesCurrent && proof.networkRequests === 0), true);
});

test("vendored font and licence match the exact historical lock", async () => {
  const lock = await readJson("tools/people-seed/config/cormorant-garamond-700.json");
  const root = path.join(repoRoot, "tools", "people-seed", "vendor", lock.cacheDirectoryName);
  const [font, licence] = await Promise.all([
    fs.readFile(path.join(root, lock.fontFileName)),
    fs.readFile(path.join(root, lock.licenceFileName)),
  ]);
  assert.equal(sha256(font), lock.fontSha256);
  assert.equal(sha256(licence), lock.licenceSha256);
});

test("every migrated People source document still satisfies its preserved schema", async () => {
  const pairs = [
    ["data/people-base/actor-owner-supplement.json", "schemas/actor-owner-supplement.schema.json"],
    ["data/people-base/actors-seed.json", "schemas/people-seed.schema.json"],
    ["data/people-base/directors-seed.json", "schemas/people-seed.schema.json"],
    ["data/people-base/landscape-chin-safe-overrides.json", "schemas/people-landscape-chin-safe-overrides.schema.json"],
    ["data/people-base/landscape-crop-overrides.json", "schemas/landscape-crop-overrides.schema.json"],
    ["data/people-base/legacy-artwork-manifest.json", "schemas/people-artwork-manifest.schema.json"],
    ["data/people-base/legacy-presentation-manifest.json", "schemas/people-presentation-manifest.schema.json"],
    ["data/people-base/people-owner-supplement-v3.json", "schemas/people-owner-supplement-v3.schema.json"],
    ["data/people-base/people-registry.json", "schemas/people-registry.schema.json"],
    ["data/people-base/portrait-source-decisions.json", "schemas/portrait-source-decisions.schema.json"],
    ["data/people-base/sources.json", "schemas/people-sources.schema.json"],
    ["data/people-base/title-logo-line-break-overrides.json", "schemas/people-title-logo-line-break-overrides.schema.json"],
    ["data/people-base/title-logo-output-overrides.json", "schemas/people-title-logo-output-overrides.schema.json"],
    ["data/people-base/title-logo-v2-publication.json", "schemas/people-title-logo-v2-publication.schema.json"],
  ];
  for (const [documentPath, schemaPath] of pairs) {
    const [document, schema] = await Promise.all([readJson(documentPath), readJson(schemaPath)]);
    assert.deepEqual(validateAgainstSchema(document, schema, documentPath), [], documentPath);
  }
});

test("base-artwork code is credential-free, network-free, bounded, and staging-only", async () => {
  const sourceRoot = path.join(repoRoot, "tools", "people-seed", "src");
  const files = (await walk(sourceRoot)).filter((filePath) => filePath.endsWith(".mjs"));
  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/u, filePath);
    assert.doesNotMatch(source, /api\.themoviedb\.org|image\.tmdb\.org|TMDB_BEARER_TOKEN|api_key/iu, filePath);
  }
  assert.deepEqual(parseBaseArtworkArguments(["--person-id", "1,31", "--source-cache", ".work/cache"]).personIds, [1, 31]);
  assert.equal(parseConsolidationArguments(["--source-cache", ".work/cache"]).sourceCaches.length, 1);
  assert.throws(() => parseBaseArtworkArguments(["--person-id", Array.from({ length: 31 }, (_, index) => index + 1).join(","), "--source-cache", ".work/cache"]), /between 1 and 30/u);
  assert.throws(() => parseBaseArtworkArguments(["--person-id", "1,1", "--source-cache", ".work/cache"]), /Duplicate/u);
  assert.throws(() => validateBaseArtworkInput({ personIds: [1, 1], sourceCaches: [".work/cache"] }), /Duplicate/u);
  await assert.rejects(() => stageBaseArtwork({ personIds: Array.from({ length: 31 }, (_, index) => index + 1), sourceCaches: [".work/cache"] }), /between 1 and 30/u);
  assert.throws(() => assertSafeOutputDirectory(path.join(repoRoot, "assets", "people", "1")), /staging-only/u);
  assert.doesNotThrow(() => assertSafeOutputDirectory(path.join(repoRoot, "tools", "people-seed", ".work", "proof")));
  assert.doesNotThrow(() => assertSafeOutputDirectory(path.join(repoRoot, "tools", "people-intake", ".work", "proof")));
});

test("cache selection prefers the exact expected hash and attempt paths remain compact", () => {
  const entries = [
    { stableKey: "person:31", profilePath: "/profile.jpg", sourceHash: "old" },
    { stableKey: "person:31", profilePath: "/profile.jpg", sourceHash: "approved" },
    { stableKey: "person:1", profilePath: "/other.jpg", sourceHash: "approved" },
  ];
  assert.deepEqual(selectSourceCacheCandidates(entries, { stableKey: "person:31", profilePath: "/profile.jpg", expectedHash: "approved" }).map((entry) => entry.sourceHash), ["approved", "old"]);
  const ids = Array.from({ length: 30 }, (_, index) => 5_000_001 + index);
  const now = new Date("2026-08-08T12:34:56.789Z");
  const first = baseArtworkAttemptName(ids, now);
  const second = baseArtworkAttemptName(ids, now);
  assert.equal(first, second);
  assert.ok(first.length < 80, first);
  assert.notEqual(first, baseArtworkAttemptName([...ids].reverse(), now));
});

test("migrated legacy title-logo renderer remains deterministic without defining the v2 publication", async () => {
  const [registry, current, legacyPresentation] = await Promise.all([
    readJson("data/people-base/people-registry.json"),
    readJson("manifests/people.json"),
    readJson("data/people-base/legacy-presentation-manifest.json"),
  ]);
  const record = registry.records.find((person) => person.tmdbPersonId === 1);
  const person = {
    stableKey: record.stableKey,
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    categoryMembership: record.categoryMembership,
  };
  const configuration = await loadTitleLogoConfiguration({ registry });
  const prepared = await prepareTitleLogoRenderer({ people: [person], configuration });
  const first = await renderTitleLogo({ person, ...prepared });
  const second = await renderTitleLogo({ person, ...prepared });
  const legacyHash = legacyPresentation.records.find((item) => item.tmdbPersonId === 1).titleLogoSha256;
  const currentHash = current.people.find((item) => item.tmdbPersonId === 1).assets.titleLogo.sha256;
  assert.equal(first.record.outputHash, legacyHash);
  assert.equal(second.record.outputHash, legacyHash);
  assert.notEqual(first.record.outputHash, currentHash);
  assert.deepEqual(first.output, second.output);
});

test("historical Tom Hanks output override remains deterministic after the v2 publication", async () => {
  const [registry, current, outputOverrideDocument] = await Promise.all([
    readJson("data/people-base/people-registry.json"),
    readJson("manifests/people.json"),
    readJson("data/people-base/title-logo-output-overrides.json"),
  ]);
  const record = registry.records.find((person) => person.tmdbPersonId === 31);
  const person = { stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, canonicalName: record.canonicalName, categoryMembership: record.categoryMembership };
  const configuration = await loadTitleLogoConfiguration({ registry });
  const overrides = await loadTitleLogoOutputOverrides({ registry });
  const prepared = await prepareTitleLogoRenderer({ people: [person], configuration });
  const base = await renderTitleLogo({ person, ...prepared });
  const first = await applyTitleLogoOutputOverride({ person, rendered: base, runtime: prepared.runtime, overrides });
  const second = await applyTitleLogoOutputOverride({ person, rendered: base, runtime: prepared.runtime, overrides });
  const historicalOverride = outputOverrideDocument.records[0];
  const currentTitleLogo = current.people.find((item) => item.tmdbPersonId === 31).assets.titleLogo;
  assert.equal(first.record.outputHash, historicalOverride.outputSha256);
  assert.equal(first.record.canvasWidth, historicalOverride.outputWidth);
  assert.equal(first.record.canvasHeight, historicalOverride.outputHeight);
  assert.notEqual(first.record.outputHash, currentTitleLogo.sha256);
  assert.deepEqual(first.output, second.output);
});
