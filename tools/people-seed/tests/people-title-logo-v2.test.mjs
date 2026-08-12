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

test("title-logo v2 design lock is deterministic, uniform, and remains publication-disabled", async () => {
  const registry = JSON.parse(await fs.readFile(path.join(repoRoot, "data", "people-base", "people-registry.json"), "utf8"));
  const people = [31, 1100].map((tmdbPersonId) => {
    const record = registry.records.find((person) => person.tmdbPersonId === tmdbPersonId);
    return { stableKey: record.stableKey, tmdbPersonId, canonicalName: record.canonicalName, categoryMembership: [...record.categoryMembership] };
  });
  const prepared = await prepareTitleLogoV2Renderer({ people });
  const first = await renderTitleLogoV2({ person: people[0], ...prepared });
  const second = await renderTitleLogoV2({ person: people[0], ...prepared });
  const longName = await renderTitleLogoV2({ person: people[1], ...prepared });
  assert.deepEqual(first.output, second.output);
  assert.equal(first.record.outputHash, second.record.outputHash);
  assert.equal(first.record.status, "design-locked");
  assert.equal(first.record.publicationAuthorised, false);
  assert.equal(first.record.collectionFontSize, 93);
  assert.equal(first.record.separatorStyle, "split-rule-open-clapboard");
  assert.equal(first.record.transparentPadding, 32);
  assert.equal(first.record.nameSizingRule, "adaptive-within-fixed-region");
  assert.equal(first.record.maximumNameFontSize, 250);
  assert.equal(first.record.nameFontSize, 250);
  assert.ok(longName.record.nameFontSize < first.record.nameFontSize);
  assert.equal(first.record.nameToSeparatorGap, 26);
  assert.equal(first.record.collectionBounds.y - first.record.separatorBounds.y - first.record.separatorBounds.height, 19);
  assert.deepEqual(first.record.separatorBounds, longName.record.separatorBounds);
  assert.deepEqual(first.record.collectionBounds, longName.record.collectionBounds);
  assert.equal(first.record.canvasWidth, 1600);
  assert.equal(first.record.canvasHeight, 480);
  assert.equal(first.record.byteCount, 35463);
  assert.equal(first.record.outputHash, "eefb65d6f9d681f3907b335b44ea253a0d7a9c90a081d1e74f9d35a2e3e8af3f");
  assert.ok(first.record.byteCount < 1024 * 1024);
});
