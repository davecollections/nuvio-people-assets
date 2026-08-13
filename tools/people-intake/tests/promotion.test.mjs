import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  APPROVAL_DOCUMENT_VERSION,
  parsePromotionApprovals,
  parsePromotionArguments,
  promoteReviewedCandidates,
  validatePublicationLedger
} from "../src/promote.mjs";
import { validatePromotionRequest } from "../src/promotion-request.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

async function writeJson(filePath, value) {
  const bytes = json(value);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return { sha256: hash(bytes), bytes: bytes.length, value };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuvio-people-promotion-"));
  const repositoryRoot = path.join(root, "repository");
  const workRoot = path.join(root, "work");
  const artifactRoot = path.join(workRoot, "artifacts");
  const attemptRoot = path.join(artifactRoot, "new-person-candidate-1-9000001", "attempt-fixture");
  const candidateRoot = path.join(attemptRoot, "candidate", "assets", "people", "9000001");
  await Promise.all([
    mkdir(path.join(repositoryRoot, "data"), { recursive: true }),
    mkdir(path.join(repositoryRoot, "manifests"), { recursive: true }),
    mkdir(path.join(repositoryRoot, "assets", "people"), { recursive: true }),
    mkdir(candidateRoot, { recursive: true })
  ]);
  const registry = { schemaVersion: 1, sourceSnapshot: "fixture", people: [] };
  const ledger = { schemaVersion: 1, ordering: "tmdb-person-id-ascending", records: [] };
  const manifest = { schemaVersion: 2, people: [] };
  await Promise.all([
    writeJson(path.join(repositoryRoot, "data", "people.json"), registry),
    writeJson(path.join(repositoryRoot, "data", "people-intake-publications.json"), ledger),
    writeJson(path.join(repositoryRoot, "manifests", "people.json"), manifest)
  ]);

  const definitions = {
    poster: { filename: "poster.webp", width: 1000, height: 1500, format: "webp" },
    landscape: { filename: "landscape.webp", width: 1200, height: 675, format: "webp" },
    titleLogo: { filename: "title-logo.png", width: 1600, height: 480, format: "png" }
  };
  const outputs = {};
  for (const [key, definition] of Object.entries(definitions)) {
    const bytes = await sharp({
      create: { width: definition.width, height: definition.height, channels: 4, background: "#202020" }
    })[definition.format]().toBuffer();
    await writeFile(path.join(candidateRoot, definition.filename), bytes);
    outputs[key] = {
      path: `tools/people-intake/.work/attempt-fixture/candidate/assets/people/9000001/${definition.filename}`,
      sha256: hash(bytes),
      bytes: bytes.length,
      width: definition.width,
      height: definition.height,
      format: definition.format
    };
  }
  const sourceSnapshot = await writeJson(path.join(attemptRoot, "reports", "source-snapshot.json"), {
    id: 9000001,
    name: "Fixture Person"
  });
  const selection = await writeJson(path.join(attemptRoot, "hero", "reports", "selection.json"), {
    personId: 9000001,
    outcome: "skip"
  });
  await writeJson(path.join(attemptRoot, "hero", "reports", "candidate-report.json"), {
    version: "nuvio-people-hero-candidate-v2",
    status: "skipped",
    person: { tmdbPersonId: 9000001 },
    preset: { id: "people-t2-perspective-v2" },
    selection: { outcome: "skip" },
    output: null,
    boundaries: { permanentAssetWrites: 0, manifestWrites: 0, publishActions: 0 }
  });
  const candidateReport = await writeJson(path.join(attemptRoot, "reports", "candidate-report.json"), {
    version: "nuvio-new-person-artwork-candidate-v1",
    status: "staging-only-needs-owner-review",
    generatedAt: "2026-08-13T00:00:00.000Z",
    person: {
      version: "nuvio-new-person-registration-candidate-v1",
      status: "owner-review-required",
      tmdbPersonId: 9000001,
      canonicalName: "Fixture Person",
      stableKey: "person:9000001",
      suggestedCategoryMembership: ["actor"]
    },
    sourceSnapshot: {
      path: "tools/people-intake/.work/attempt-fixture/reports/source-snapshot.json",
      sha256: sourceSnapshot.sha256,
      bytes: sourceSnapshot.bytes
    },
    hero: { status: "skipped", outcome: "skip", output: null },
    outputs,
    boundaries: {
      permanentAssetWrites: 0,
      registryWrites: 0,
      manifestWrites: 0,
      gitActions: 0,
      publishActions: 0
    }
  });
  const approvalDocument = {
    version: APPROVAL_DOCUMENT_VERSION,
    status: "owner-approved",
    approvals: [{
      tmdbPersonId: 9000001,
      canonicalName: "Fixture Person",
      categoryMembership: ["actor", "director"],
      candidateReportSha256: candidateReport.sha256,
      heroSelectionSha256: selection.sha256,
      heroPresetId: "people-t2-perspective-v2",
      destination: "assets/people/9000001"
    }]
  };
  return { root, repositoryRoot, workRoot, artifactRoot, outputs, approvalDocument };
}

test("promotion arguments and owner approvals fail closed", () => {
  const parsed = parsePromotionArguments([
    "--artifact-root", "artifact",
    "--approvals-file", "approval.json",
    "--staging-run-id", "123",
    "--tracking-issue", "49",
    "--promotion-run-id", "456",
    "--dry-run"
  ]);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.stagingRunId, 123);
  assert.throws(() => parsePromotionArguments([]), /artifact-root/u);

  const approved = {
    version: APPROVAL_DOCUMENT_VERSION,
    status: "owner-approved",
    approvals: [{
      tmdbPersonId: 9000001,
      canonicalName: "Fixture Person",
      categoryMembership: ["actor"],
      candidateReportSha256: "a".repeat(64),
      heroSelectionSha256: "b".repeat(64),
      heroPresetId: "people-t2-perspective-v2",
      destination: "assets/people/9000001"
    }]
  };
  assert.equal(parsePromotionApprovals(JSON.stringify(approved)).approvals[0].tmdbPersonId, 9000001);
  assert.throws(() => parsePromotionApprovals(JSON.stringify({ ...approved, status: "owner-confirmation-required" })), /owner-approved/u);
  assert.throws(() => parsePromotionApprovals(JSON.stringify({ ...approved, approvals: [
    { ...approved.approvals[0], destination: "assets/people/other" }
  ] })), /destination/u);
  assert.throws(() => parsePromotionApprovals(JSON.stringify({ ...approved, approvals: [
    { ...approved.approvals[0], categoryMembership: ["director", "actor"] }
  ] })), /categoryMembership/u);
});

test("promotion request validates numeric workflow inputs without exposing approval JSON", () => {
  const document = {
    version: APPROVAL_DOCUMENT_VERSION,
    status: "owner-approved",
    approvals: [{
      tmdbPersonId: 1,
      canonicalName: "Person",
      categoryMembership: ["actor"],
      candidateReportSha256: "a".repeat(64),
      heroSelectionSha256: "b".repeat(64),
      heroPresetId: "people-t2-perspective-v2",
      destination: "assets/people/1"
    }]
  };
  const request = validatePromotionRequest({
    stagingRunId: "123",
    trackingIssue: "49",
    promotionRunId: "456",
    approvalsJson: JSON.stringify(document)
  });
  assert.equal(request.stagingRunId, 123);
  assert.throws(() => validatePromotionRequest({
    stagingRunId: "123; echo unsafe",
    trackingIssue: "49",
    promotionRunId: "456",
    approvalsJson: JSON.stringify(document)
  }), /positive/u);
});

test("reviewed candidates validate by exact report, selection, identity, file set, and output hashes", async (context) => {
  const item = await fixture();
  context.after(async () => rm(item.root, { recursive: true, force: true }));
  const approvals = parsePromotionApprovals(JSON.stringify(item.approvalDocument));
  const dryRun = await promoteReviewedCandidates({
    artifactRoot: item.artifactRoot,
    approvals,
    stagingRunId: 123,
    trackingIssue: 49,
    promotionRunId: 456,
    dryRun: true,
    repositoryRoot: item.repositoryRoot,
    workRoot: item.workRoot
  });
  assert.equal(dryRun.result.status, "validated-no-writes");
  assert.equal(dryRun.result.candidateAssetCount, 3);
  assert.equal(dryRun.result.assetWrites, 0);
  assert.equal(dryRun.result.networkRequests, 0);
  assert.match(dryRun.markdown, /copied byte-for-byte/u);

  const changed = structuredClone(item.approvalDocument);
  changed.approvals[0].candidateReportSha256 = "0".repeat(64);
  await assert.rejects(() => promoteReviewedCandidates({
    artifactRoot: item.artifactRoot,
    approvals: parsePromotionApprovals(JSON.stringify(changed)),
    stagingRunId: 123,
    trackingIssue: 49,
    promotionRunId: 456,
    dryRun: true,
    repositoryRoot: item.repositoryRoot,
    workRoot: item.workRoot
  }), /does not match owner approval/u);
});

test("promotion copies reviewed bytes, adds the canonical identity and ledger record, and rebuilds the manifest", async (context) => {
  const item = await fixture();
  context.after(async () => rm(item.root, { recursive: true, force: true }));
  const approvals = parsePromotionApprovals(JSON.stringify(item.approvalDocument));
  const inventoryBuilder = async () => {
    const registry = JSON.parse(await readFile(path.join(item.repositoryRoot, "data", "people.json"), "utf8"));
    return {
      schemaVersion: 2,
      people: registry.people.map((person) => ({ ...person, assets: item.outputs }))
    };
  };
  const promoted = await promoteReviewedCandidates({
    artifactRoot: item.artifactRoot,
    approvals,
    stagingRunId: 123,
    trackingIssue: 49,
    promotionRunId: 456,
    repositoryRoot: item.repositoryRoot,
    workRoot: item.workRoot,
    inventoryBuilder
  });
  assert.equal(promoted.result.status, "promoted-to-review-branch");
  assert.equal(promoted.result.assetWrites, 3);
  const registry = JSON.parse(await readFile(path.join(item.repositoryRoot, "data", "people.json"), "utf8"));
  const ledger = JSON.parse(await readFile(path.join(item.repositoryRoot, "data", "people-intake-publications.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(item.repositoryRoot, "manifests", "people.json"), "utf8"));
  assert.deepEqual(registry.people[0].categoryMembership, ["actor", "director"]);
  assert.equal(ledger.records[0].candidateReportSha256, item.approvalDocument.approvals[0].candidateReportSha256);
  assert.equal(await readFile(path.join(item.repositoryRoot, "assets", "people", "9000001", "poster.webp"), "hex"),
    await readFile(path.join(item.artifactRoot, "new-person-candidate-1-9000001", "attempt-fixture", "candidate", "assets", "people", "9000001", "poster.webp"), "hex"));
  assert.doesNotThrow(() => validatePublicationLedger({ ledger, registry, manifest }));
});

test("the tracked publication ledger is valid for the current canonical catalogue", async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const [ledger, registry, manifest] = await Promise.all([
    readFile(path.join(root, "data", "people-intake-publications.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "people.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "manifests", "people.json"), "utf8").then(JSON.parse)
  ]);
  assert.equal(validatePublicationLedger({ ledger, registry, manifest }), true);
});

test("promotion code cannot fetch metadata, download images, render artwork, or invoke git", async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const source = await readFile(path.join(root, "tools", "people-intake", "src", "promote.mjs"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|downloadOfficialImage|renderPeopleArtwork|stageHeroCandidate/u);
  assert.doesNotMatch(source, /TMDB_BEARER_TOKEN|api_key|api\.themoviedb\.org/iu);
  assert.doesNotMatch(source, /git\s+(add|commit|push)|gh\s+pr/u);
});
