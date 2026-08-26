import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  parseRefreshPromotionApprovals,
  promoteReviewedRefreshes
} from "../src/refresh-promote.mjs";
import {
  buildRefreshState,
  buildRefreshStateRecord,
  sha256,
  stableJson
} from "../src/refresh-state.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuvio-refresh-promotion-"));
  const repositoryRoot = path.join(root, "repository");
  const workRoot = path.join(root, "work");
  const artifactRoot = path.join(workRoot, "artifacts", "candidate-31");
  const reportsRoot = path.join(artifactRoot, "reports");
  const stagingRoot = path.join(artifactRoot, "staging");
  await Promise.all([
    mkdir(path.join(repositoryRoot, "data"), { recursive: true }),
    mkdir(path.join(repositoryRoot, "manifests"), { recursive: true }),
    mkdir(reportsRoot, { recursive: true }),
    mkdir(stagingRoot, { recursive: true })
  ]);
  const oldHeroHash = "a".repeat(64);
  const sourceSnapshot = { id: 31, name: "Tom Hanks" };
  const selection = {
    outcome: "sparse-fallback",
    selectedCredits: [{ mediaType: "movie", mediaId: 1, posterPath: "/poster.jpg", backdropPath: "/backdrop.jpg" }],
    fallbackProfiles: [],
    eligibleCreditCount: 1,
    usableProfileCount: 0,
    rejected: []
  };
  const snapshotBytes = Buffer.from(stableJson(sourceSnapshot));
  const selectionBytes = Buffer.from(stableJson(selection));
  const candidateBytes = await sharp({
    create: { width: 2560, height: 1440, channels: 3, background: "#123456" }
  }).webp({ quality: 82 }).toBuffer();
  const candidateHash = sha256(candidateBytes);
  const report = {
    version: "nuvio-people-hero-candidate-v2",
    status: "staging-only-needs-owner-review",
    person: { tmdbPersonId: 31, canonicalName: "Tom Hanks", categoryMembership: ["actor"] },
    preset: { id: "people-t2-perspective-v2" },
    output: { sha256: candidateHash },
    boundaries: { permanentAssetWrites: 0, manifestWrites: 0, publishActions: 0 }
  };
  const reportBytes = Buffer.from(stableJson(report));
  const approval = {
    tmdbPersonId: 31,
    expectedPublishedHeroSha256: oldHeroHash,
    candidateHeroSha256: candidateHash,
    candidateReportSha256: sha256(reportBytes),
    heroSelectionSha256: sha256(selectionBytes),
    sourceSnapshotSha256: sha256(snapshotBytes),
    heroPresetId: "people-t2-perspective-v2",
    destination: "assets/people/31/hero.webp"
  };
  const review = {
    version: "nuvio-people-hero-refresh-review-v1",
    status: "needs-owner-review",
    canonicalName: "Tom Hanks",
    ...approval
  };
  await Promise.all([
    writeFile(path.join(stagingRoot, "hero.webp"), candidateBytes),
    writeFile(path.join(reportsRoot, "candidate-report.json"), reportBytes),
    writeFile(path.join(reportsRoot, "selection.json"), selectionBytes),
    writeFile(path.join(reportsRoot, "source-snapshot.json"), snapshotBytes),
    writeFile(path.join(reportsRoot, "refresh-review.json"), stableJson(review)),
    writeFile(path.join(reportsRoot, "compositor-report.json"), stableJson({ version: "fixture" })),
    writeFile(path.join(reportsRoot, "review-approval-template.json"), stableJson({ status: "needs-owner-review" }))
  ]);
  const registry = { people: [{ tmdbPersonId: 31, canonicalName: "Tom Hanks", categoryMembership: ["actor"] }] };
  const manifest = { people: [{ tmdbPersonId: 31, assets: { hero: { sha256: oldHeroHash } } }] };
  const state = buildRefreshState([buildRefreshStateRecord({
    tmdbPersonId: 31,
    publishedHeroSha256: oldHeroHash,
    sourceSnapshotSha256: "b".repeat(64),
    selection
  })]);
  await Promise.all([
    writeFile(path.join(repositoryRoot, "data", "people.json"), stableJson(registry)),
    writeFile(path.join(repositoryRoot, "data", "people-hero-refresh-state.json"), stableJson(state)),
    writeFile(path.join(repositoryRoot, "manifests", "people.json"), stableJson(manifest))
  ]);
  const approvals = parseRefreshPromotionApprovals(stableJson({
    version: "nuvio-people-hero-refresh-approval-batch-v1",
    status: "owner-approved",
    approvals: [approval]
  }));
  return { repositoryRoot, workRoot, artifactRoot: path.join(workRoot, "artifacts"), approvals, approval, reportsRoot, stagingRoot };
}

test("refresh promotion approvals require exact owner-reviewed fields", () => {
  const base = {
    version: "nuvio-people-hero-refresh-approval-batch-v1",
    status: "owner-approved",
    approvals: [{
      tmdbPersonId: 31,
      expectedPublishedHeroSha256: "a".repeat(64),
      candidateHeroSha256: "b".repeat(64),
      candidateReportSha256: "c".repeat(64),
      heroSelectionSha256: "d".repeat(64),
      sourceSnapshotSha256: "e".repeat(64),
      heroPresetId: "people-t2-perspective-v2",
      destination: "assets/people/31/hero.webp"
    }]
  };
  assert.equal(parseRefreshPromotionApprovals(JSON.stringify(base)).approvals.length, 1);
  const pending = structuredClone(base);
  pending.status = "needs-owner-review";
  assert.throws(() => parseRefreshPromotionApprovals(JSON.stringify(pending)), /owner-approved/u);
  const extra = structuredClone(base);
  extra.approvals[0].unexpected = true;
  assert.throws(() => parseRefreshPromotionApprovals(JSON.stringify(extra)), /exact reviewed fields/u);
});

test("refresh promotion validates exact bytes and performs no work in dry-run mode", async () => {
  const item = await fixture();
  const promoted = await promoteReviewedRefreshes({
    artifactRoot: item.artifactRoot,
    approvals: item.approvals,
    stagingRunId: 100,
    trackingIssue: 83,
    promotionRunId: 101,
    dryRun: true,
    repositoryRoot: item.repositoryRoot,
    workRoot: item.workRoot
  });
  assert.equal(promoted.result.status, "validated-no-writes");
  assert.equal(promoted.result.assetWrites, 0);
  assert.deepEqual(promoted.result.personIds, [31]);
});

test("refresh promotion rejects changed candidate bytes and changed published state", async () => {
  const changedBytes = await fixture();
  const candidatePath = path.join(changedBytes.stagingRoot, "hero.webp");
  await writeFile(candidatePath, Buffer.concat([await readFile(candidatePath), Buffer.from("changed")]));
  await assert.rejects(promoteReviewedRefreshes({
    artifactRoot: changedBytes.artifactRoot,
    approvals: changedBytes.approvals,
    stagingRunId: 100,
    trackingIssue: 83,
    promotionRunId: 101,
    dryRun: true,
    repositoryRoot: changedBytes.repositoryRoot,
    workRoot: changedBytes.workRoot
  }), /candidate hero hash differs/u);

  const drifted = await fixture();
  const manifestPath = path.join(drifted.repositoryRoot, "manifests", "people.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.people[0].assets.hero.sha256 = "f".repeat(64);
  await writeFile(manifestPath, stableJson(manifest));
  await assert.rejects(promoteReviewedRefreshes({
    artifactRoot: drifted.artifactRoot,
    approvals: drifted.approvals,
    stagingRunId: 100,
    trackingIssue: 83,
    promotionRunId: 101,
    dryRun: true,
    repositoryRoot: drifted.repositoryRoot,
    workRoot: drifted.workRoot
  }), /differs from the manifest/u);
});

test("refresh promotion rejects unexpected files in a staged candidate", async () => {
  const item = await fixture();
  await writeFile(path.join(item.reportsRoot, "unexpected.json"), "{}\n", "utf8");
  await assert.rejects(promoteReviewedRefreshes({
    artifactRoot: item.artifactRoot,
    approvals: item.approvals,
    stagingRunId: 100,
    trackingIssue: 83,
    promotionRunId: 101,
    dryRun: true,
    repositoryRoot: item.repositoryRoot,
    workRoot: item.workRoot
  }), /unexpected file set/u);
});
