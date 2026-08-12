import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prepareTitleLogoV2Renderer, renderTitleLogoV2 } from "../src/people-artwork/title-logo-v2.mjs";
import { parseTitleLogoV2ProofArguments } from "../src/title-logo-v2-proof.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("title-logo v2 proof CLI requires a narrow explicit identity set", () => {
  assert.deepEqual(parseTitleLogoV2ProofArguments(["--person-id", "1922,31"]), { personIds: [31, 1922], help: false });
  assert.throws(() => parseTitleLogoV2ProofArguments([]), /between 1 and 12/u);
  assert.throws(() => parseTitleLogoV2ProofArguments(["--person-id", "31,31"]), /Duplicate/u);
  assert.throws(() => parseTitleLogoV2ProofArguments(["--person-id", "31", "--unexpected"]), /Unknown/u);
});

test("title-logo v2 final design lock is deterministic, uniformly sized, and remains publication-disabled", async () => {
  const registry = JSON.parse(await fs.readFile(path.join(repoRoot, "data", "people-base", "people-registry.json"), "utf8"));
  const people = [31, 8193, 38225, 1245, 8741].map((tmdbPersonId) => {
    const record = registry.records.find((person) => person.tmdbPersonId === tmdbPersonId);
    return { stableKey: record.stableKey, tmdbPersonId, canonicalName: record.canonicalName, categoryMembership: [...record.categoryMembership] };
  });
  const prepared = await prepareTitleLogoV2Renderer({ people });
  const first = await renderTitleLogoV2({ person: people[0], ...prepared });
  const second = await renderTitleLogoV2({ person: people[0], ...prepared });
  const longestName = await renderTitleLogoV2({ person: people[1], ...prepared });
  const shortestName = await renderTitleLogoV2({ person: people[2], ...prepared });
  const onePixelCompaction = await renderTitleLogoV2({ person: people[3], ...prepared });
  const maximumCompaction = await renderTitleLogoV2({ person: people[4], ...prepared });
  assert.deepEqual(first.output, second.output);
  assert.equal(first.record.outputHash, second.record.outputHash);
  assert.equal(first.record.status, "design-locked");
  assert.equal(first.record.publicationAuthorised, false);
  assert.equal(first.record.rendererVersion, "people-title-logo-standard-canvas-renderer-v5");
  assert.equal(first.record.collectionFontSize, 97.65);
  assert.equal(first.record.collectionTracking, 10.6575);
  assert.equal(first.record.separatorStyle, "split-rule-open-clapboard");
  assert.equal(first.record.transparentPadding, 24);
  assert.equal(first.record.nameSizingRule, "uniform-fixed");
  assert.equal(first.record.lockedNameFontSize, 150);
  assert.equal(first.record.nameFontSize, 150);
  assert.equal(longestName.record.nameFontSize, 150);
  assert.equal(shortestName.record.nameFontSize, 150);
  assert.equal(onePixelCompaction.record.nameFontSize, 150);
  assert.equal(maximumCompaction.record.nameFontSize, 150);
  assert.deepEqual(longestName.record.nameBounds, { x: 3, y: 41, width: 1594, height: 250 });
  assert.equal(first.record.lineGapAdjustment, 0);
  assert.equal(first.record.visibleLineGap, null);
  assert.equal(onePixelCompaction.record.lineGapAdjustment, 1);
  assert.equal(onePixelCompaction.record.visibleLineGap, 28);
  assert.deepEqual(onePixelCompaction.record.nameBounds, { x: 358, y: 32, width: 885, height: 259 });
  assert.equal(maximumCompaction.record.lineGapAdjustment, 13);
  assert.equal(maximumCompaction.record.visibleLineGap, 2);
  assert.deepEqual(maximumCompaction.record.nameBounds, { x: 428, y: 32, width: 744, height: 259 });
  assert.equal(first.record.nameToSeparatorGap, 26);
  assert.equal(first.record.collectionBounds.y - first.record.separatorBounds.y - first.record.separatorBounds.height, 19);
  assert.deepEqual(first.record.separatorBounds, { x: 450, y: 317, width: 700, height: 50 });
  assert.deepEqual(first.record.collectionBounds, { x: 452, y: 386, width: 697, height: 66 });
  assert.deepEqual(first.record.separatorBounds, longestName.record.separatorBounds);
  assert.deepEqual(first.record.separatorBounds, shortestName.record.separatorBounds);
  assert.deepEqual(first.record.collectionBounds, longestName.record.collectionBounds);
  assert.deepEqual(first.record.collectionBounds, shortestName.record.collectionBounds);
  assert.equal(first.record.canvasWidth, 1600);
  assert.equal(first.record.canvasHeight, 480);
  assert.equal(first.record.byteCount, 27759);
  assert.equal(first.record.outputHash, "46b63a7537afffe57eef65d8465fa472f6756bcd47700e01a67d74342ad8fef4");
  assert.equal(longestName.record.outputHash, "da04b13e8c2ca2d445f8d9f9572c55237f6143dbc34bc3242765b19cf3506869");
  assert.equal(shortestName.record.outputHash, "6e31a88f1a3ec1892fa2f9361df9f886caf4cd789784681ac8ed4e39e22f0b5f");
  assert.ok(first.record.byteCount < 1024 * 1024);
});
