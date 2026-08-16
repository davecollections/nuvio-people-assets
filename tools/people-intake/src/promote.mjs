#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";

import { buildInventory, repositoryRoot as canonicalRepositoryRoot } from "../../../scripts/lib/inventory.mjs";
import { isPathInside } from "../../people-hero/src/preflight.mjs";
import {
  buildNewPersonArtworkOverrideEvidence,
  loadNewPersonArtworkOverrides
} from "./artwork-overrides.mjs";
import { buildNewPersonLandscapePolicyEvidence } from "./landscape-policy.mjs";

export const MAXIMUM_PROMOTION_BATCH_SIZE = 30;
export const APPROVAL_DOCUMENT_VERSION = "nuvio-new-person-review-approval-batch-v1";
export const PUBLICATION_LEDGER_VERSION = 1;
export const LOCKED_HERO_PRESET_ID = "people-t2-perspective-v2";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultWorkRoot = path.join(moduleRoot, "tools", "people-intake", ".work");
const HASH = /^[a-f0-9]{64}$/u;
const APPROVAL_KEYS = new Set([
  "tmdbPersonId",
  "canonicalName",
  "categoryMembership",
  "candidateReportSha256",
  "heroSelectionSha256",
  "heroPresetId",
  "destination"
]);
const CATEGORY_SETS = new Set(["actor", "director", "actor,director"]);
const ASSETS = Object.freeze({
  poster: { filename: "poster.webp", format: "webp", width: 1000, height: 1500, required: true },
  landscape: { filename: "landscape.webp", format: "webp", width: 1200, height: 675, required: true },
  titleLogo: { filename: "title-logo.png", format: "png", width: 1600, height: 480, required: true },
  focusPoster: { filename: "focus-poster.webp", format: "webp", width: 1000, height: 1500, required: false },
  focusLandscape: { filename: "focus-landscape.webp", format: "webp", width: 1200, height: 675, required: false },
  hero: { filename: "hero.webp", format: "webp", width: 2560, height: 1440, required: false }
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function positiveInteger(value, label) {
  const raw = String(value ?? "").trim();
  assert(/^[1-9]\d*$/u.test(raw), `${label} must be a positive integer`);
  const parsed = Number(raw);
  assert(Number.isSafeInteger(parsed), `${label} is outside the safe integer range`);
  return parsed;
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  assert(value && !value.startsWith("--"), `${name} requires a value`);
  return value;
}

export function parsePromotionArguments(argv) {
  const options = {
    artifactRoot: null,
    approvalsFile: null,
    stagingRunId: null,
    trackingIssue: null,
    promotionRunId: null,
    reportFile: null,
    summaryFile: null,
    githubOutput: null,
    dryRun: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (["--artifact-root", "--approvals-file", "--report-file", "--summary-file", "--github-output"].includes(argument)) {
      const key = {
        "--artifact-root": "artifactRoot",
        "--approvals-file": "approvalsFile",
        "--report-file": "reportFile",
        "--summary-file": "summaryFile",
        "--github-output": "githubOutput"
      }[argument];
      options[key] = takeValue(argv, index, argument);
      index += 1;
    } else if (["--staging-run-id", "--tracking-issue", "--promotion-run-id"].includes(argument)) {
      const key = {
        "--staging-run-id": "stagingRunId",
        "--tracking-issue": "trackingIssue",
        "--promotion-run-id": "promotionRunId"
      }[argument];
      options[key] = positiveInteger(takeValue(argv, index, argument), argument.slice(2));
      index += 1;
    } else throw new Error(`Unknown promotion argument: ${argument}`);
  }
  if (!options.help) {
    assert(options.artifactRoot, "--artifact-root is required");
    assert(options.approvalsFile, "--approvals-file is required");
    assert(options.stagingRunId, "--staging-run-id is required");
    assert(options.trackingIssue, "--tracking-issue is required");
    assert(options.promotionRunId, "--promotion-run-id is required");
  }
  return options;
}

export function parsePromotionApprovals(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error("Promotion approvals must be valid JSON");
  }
  assert(document?.version === APPROVAL_DOCUMENT_VERSION,
    `Approval document version must be ${APPROVAL_DOCUMENT_VERSION}`);
  assert(document.status === "owner-approved",
    "Approval document status must be owner-approved; unedited review templates cannot be promoted");
  assert(Array.isArray(document.approvals), "Approval document must contain an approvals array");
  assert(document.approvals.length > 0, "Approve at least one new Person candidate");
  assert(document.approvals.length <= MAXIMUM_PROMOTION_BATCH_SIZE,
    `Promotion cannot exceed ${MAXIMUM_PROMOTION_BATCH_SIZE} people`);

  const seen = new Set();
  const approvals = document.approvals.map((approval, index) => {
    assert(approval && typeof approval === "object" && !Array.isArray(approval),
      `Approval ${index + 1} must be an object`);
    const keys = Object.keys(approval);
    assert(keys.every((key) => APPROVAL_KEYS.has(key)) && keys.length === APPROVAL_KEYS.size,
      `Approval ${index + 1} must contain only the exact reviewed approval fields`);
    const tmdbPersonId = positiveInteger(approval.tmdbPersonId, `Approval ${index + 1} TMDB Person ID`);
    assert(!seen.has(tmdbPersonId), `Duplicate approval for TMDB Person ID ${tmdbPersonId}`);
    seen.add(tmdbPersonId);
    assert(typeof approval.canonicalName === "string" && approval.canonicalName.trim() === approval.canonicalName,
      `${tmdbPersonId}: canonicalName must be non-empty and trimmed`);
    assert(!/[\u0000\r\n]/u.test(approval.canonicalName),
      `${tmdbPersonId}: canonicalName cannot contain control or line-break characters`);
    assert(Array.isArray(approval.categoryMembership), `${tmdbPersonId}: categoryMembership must be an array`);
    const categoryKey = approval.categoryMembership.join(",");
    assert(CATEGORY_SETS.has(categoryKey),
      `${tmdbPersonId}: categoryMembership must be actor, director, or actor then director`);
    assert(HASH.test(approval.candidateReportSha256 || ""), `${tmdbPersonId}: invalid candidate report SHA-256`);
    assert(HASH.test(approval.heroSelectionSha256 || ""), `${tmdbPersonId}: invalid hero selection SHA-256`);
    assert(approval.heroPresetId === LOCKED_HERO_PRESET_ID,
      `${tmdbPersonId}: hero preset must be ${LOCKED_HERO_PRESET_ID}`);
    assert(approval.destination === `assets/people/${tmdbPersonId}`,
      `${tmdbPersonId}: destination must be assets/people/${tmdbPersonId}`);
    return {
      tmdbPersonId,
      canonicalName: approval.canonicalName,
      categoryMembership: [...approval.categoryMembership],
      candidateReportSha256: approval.candidateReportSha256,
      heroSelectionSha256: approval.heroSelectionSha256,
      heroPresetId: approval.heroPresetId,
      destination: approval.destination
    };
  });
  return { version: document.version, status: document.status, approvals };
}

export function assertPromotionWorkPath(targetPath, workRoot = defaultWorkRoot) {
  const resolved = path.resolve(targetPath);
  const resolvedWorkRoot = path.resolve(workRoot);
  assert(isPathInside(resolvedWorkRoot, resolved) && resolved !== resolvedWorkRoot,
    `Promotion evidence must stay below tools/people-intake/.work: ${resolved}`);
  return resolved;
}

async function readJsonRecord(filePath) {
  const bytes = await readFile(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${filePath}: expected valid JSON`);
  }
  return { value, bytes: bytes.length, sha256: sha256(bytes) };
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function discoverCandidates(artifactRoot) {
  const files = await walk(artifactRoot);
  const candidates = [];
  for (const filePath of files.filter((file) => path.basename(file) === "candidate-report.json")) {
    const record = await readJsonRecord(filePath);
    if (record.value?.version !== "nuvio-new-person-artwork-candidate-v1") continue;
    candidates.push({ reportPath: filePath, reportRecord: record });
  }
  return candidates;
}

async function inspectAsset(filePath, definition) {
  const bytes = await readFile(filePath);
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  assert(metadata.format === definition.format, `${filePath}: expected ${definition.format}`);
  assert(metadata.width === definition.width && metadata.height === definition.height,
    `${filePath}: expected ${definition.width}x${definition.height}`);
  assert(bytes.length < 1024 * 1024, `${filePath}: asset reaches or exceeds the 1 MiB ceiling`);
  return {
    filename: definition.filename,
    sha256: sha256(bytes),
    bytes: bytes.length,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format
  };
}

function assertReportedAsset(personId, key, reported, inspected) {
  assert(reported && typeof reported === "object", `${personId}: candidate report is missing ${key}`);
  const expectedSuffix = `/candidate/assets/people/${personId}/${inspected.filename}`;
  assert(String(reported.path || "").replaceAll("\\", "/").endsWith(expectedSuffix),
    `${personId}: ${key} report path does not bind the reviewed destination`);
  for (const field of ["sha256", "bytes", "width", "height", "format"]) {
    assert(reported[field] === inspected[field], `${personId}: ${key} ${field} differs from the reviewed bytes`);
  }
}

function assertReportedEvidence(personId, key, reported, inspected, expectedSuffix) {
  assert(reported && typeof reported === "object", `${personId}: candidate report is missing ${key} evidence`);
  assert(String(reported.path || "").replaceAll("\\", "/").endsWith(expectedSuffix),
    `${personId}: ${key} evidence path is not bound to the staged report`);
  assert(reported.sha256 === inspected.sha256 && reported.bytes === inspected.bytes,
    `${personId}: ${key} evidence differs from the hash-bound candidate report`);
}

async function verifyCandidate({ candidate, approval, artworkOverrideConfiguration }) {
  const { reportPath, reportRecord } = candidate;
  const report = reportRecord.value;
  const personId = approval.tmdbPersonId;
  assert(reportRecord.sha256 === approval.candidateReportSha256,
    `${personId}: candidate report SHA-256 does not match owner approval`);
  assert(report.status === "staging-only-needs-owner-review", `${personId}: candidate is not staging-only review output`);
  assert(report.person?.tmdbPersonId === personId, `${personId}: candidate report identity mismatch`);
  assert(report.person?.stableKey === `person:${personId}`, `${personId}: candidate stable key mismatch`);
  assert(report.person?.canonicalName === approval.canonicalName, `${personId}: approved name differs from candidate`);
  assert(report.person?.status === "owner-review-required", `${personId}: registration candidate status is invalid`);
  const boundaryKeys = ["gitActions", "manifestWrites", "permanentAssetWrites", "publishActions", "registryWrites"];
  assert(JSON.stringify(Object.keys(report.boundaries || {}).sort()) === JSON.stringify(boundaryKeys)
    && boundaryKeys.every((key) => report.boundaries[key] === 0),
    `${personId}: staging report recorded a permanent or publication action`);

  const attemptRoot = path.dirname(path.dirname(reportPath));
  const candidateRoot = path.join(attemptRoot, "candidate", "assets", "people", String(personId));
  const sourceSnapshotPath = path.join(attemptRoot, "reports", "source-snapshot.json");
  const selectionPath = path.join(attemptRoot, "hero", "reports", "selection.json");
  const heroReportPath = path.join(attemptRoot, "hero", "reports", "candidate-report.json");
  const monochromeMetadataPath = path.join(attemptRoot, "reports", "monochrome-render-metadata.json");
  const hasProfile = Boolean(report.profileSource?.filePath);
  const focusMetadataPath = hasProfile ? path.join(attemptRoot, "reports", "focus-render-metadata.json") : null;
  const [sourceSnapshot, selection, heroReport, monochromeMetadata, focusMetadata] = await Promise.all([
    readJsonRecord(sourceSnapshotPath),
    readJsonRecord(selectionPath),
    readJsonRecord(heroReportPath),
    readJsonRecord(monochromeMetadataPath),
    focusMetadataPath ? readJsonRecord(focusMetadataPath) : Promise.resolve(null)
  ]);
  assert(sourceSnapshot.sha256 === report.sourceSnapshot?.sha256,
    `${personId}: source snapshot differs from the candidate report`);
  assert(sourceSnapshot.value?.id === personId, `${personId}: source snapshot identity mismatch`);
  assert(selection.sha256 === approval.heroSelectionSha256,
    `${personId}: hero source-selection SHA-256 does not match owner approval`);
  assert(heroReport.value?.preset?.id === approval.heroPresetId,
    `${personId}: hero report preset differs from owner approval`);
  assert(heroReport.value?.person?.tmdbPersonId === personId, `${personId}: hero report identity mismatch`);
  assert(heroReport.value?.selection?.outcome === report.hero?.outcome,
    `${personId}: top-level and hero selection outcomes differ`);
  assert(Object.values(heroReport.value?.boundaries || {}).every((count) => count === 0)
    && Object.keys(heroReport.value?.boundaries || {}).length === 3,
  `${personId}: hero report recorded a permanent or publication action`);

  const { renderMetadata: reportedRenderMetadata, ...reportedLandscapePolicy } = report.landscapeCropPolicy || {};
  const expectedLandscapePolicy = buildNewPersonLandscapePolicyEvidence({
    personId,
    hasProfile,
    monochromeMetadata: monochromeMetadata.value,
    focusMetadata: focusMetadata?.value || null,
    artworkOverrideConfiguration
  });
  assert(isDeepStrictEqual(reportedLandscapePolicy, expectedLandscapePolicy),
    `${personId}: candidate report chin-safe evidence differs from the render metadata`);
  assertReportedEvidence(personId, "monochrome Landscape policy", reportedRenderMetadata?.monochrome,
    monochromeMetadata, `/reports/monochrome-render-metadata.json`);
  if (hasProfile) {
    assertReportedEvidence(personId, "focus Landscape policy", reportedRenderMetadata?.focus,
      focusMetadata, `/reports/focus-render-metadata.json`);
  } else {
    assert(reportedRenderMetadata?.focus === null, `${personId}: profile-free candidate reports focus Landscape policy evidence`);
  }
  const expectedArtworkOverrides = hasProfile ? buildNewPersonArtworkOverrideEvidence({
    personId,
    monochromeMetadata: monochromeMetadata.value,
    focusMetadata: focusMetadata.value,
    configuration: artworkOverrideConfiguration
  }) : null;
  if (expectedArtworkOverrides) {
    assert(isDeepStrictEqual(report.artworkOverrides, expectedArtworkOverrides),
      `${personId}: candidate report reviewed artwork override evidence differs from the render metadata`);
  } else {
    assert(!Object.hasOwn(report, "artworkOverrides"),
      `${personId}: candidate unexpectedly reports a reviewed artwork override`);
  }

  const directoryFiles = (await readdir(candidateRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const reportedKeys = Object.keys(report.outputs || {}).sort();
  assert(reportedKeys.every((key) => ASSETS[key]), `${personId}: candidate report contains an unsupported asset`);
  for (const [key, definition] of Object.entries(ASSETS)) {
    if (definition.required) assert(reportedKeys.includes(key), `${personId}: candidate is missing required ${key}`);
  }
  assert(reportedKeys.includes("focusPoster") === reportedKeys.includes("focusLandscape"),
    `${personId}: focus artwork must be a complete pair`);
  assert(hasProfile === reportedKeys.includes("focusPoster"),
    `${personId}: profile source and focus artwork contract differ`);
  const expectedFiles = reportedKeys.map((key) => ASSETS[key].filename).sort();
  assert(JSON.stringify(directoryFiles) === JSON.stringify(expectedFiles),
    `${personId}: candidate directory does not exactly match the reported file set`);

  const assets = {};
  for (const key of reportedKeys) {
    const definition = ASSETS[key];
    const sourcePath = path.join(candidateRoot, definition.filename);
    const inspected = await inspectAsset(sourcePath, definition);
    assertReportedAsset(personId, key, report.outputs[key], inspected);
    assets[key] = { ...inspected, sourcePath };
  }
  const heroAsset = assets.hero;
  assert(expectedLandscapePolicy.monochrome.outputHash === assets.landscape.sha256,
    `${personId}: monochrome Landscape chin-safe evidence differs from the reviewed bytes`);
  if (hasProfile) {
    assert(expectedLandscapePolicy.focus.outputHash === assets.focusLandscape?.sha256,
      `${personId}: focus Landscape chin-safe evidence differs from the reviewed bytes`);
  }
  if (heroAsset) {
    assert(heroReport.value?.output?.sha256 === heroAsset.sha256,
      `${personId}: hero report output differs from candidate bytes`);
    assert(report.hero?.output?.sha256 === heroAsset.sha256,
      `${personId}: top-level hero output differs from candidate bytes`);
  } else {
    assert(heroReport.value?.status === "skipped" && report.hero?.status === "skipped",
      `${personId}: missing hero is not bound to a skip outcome`);
  }

  return {
    approval,
    report,
    reportPath,
    candidateRoot,
    sourceSnapshotSha256: sourceSnapshot.sha256,
    heroSelectionSha256: selection.sha256,
    heroOutcome: heroReport.value.selection?.outcome || null,
    assets
  };
}

function compactAssets(assets) {
  return Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, {
    filename: asset.filename,
    sha256: asset.sha256,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    format: asset.format
  }]));
}

function resultAssets(assets) {
  return Object.fromEntries(Object.entries(compactAssets(assets)).map(([key, asset]) => [key, {
    ...asset,
    previousSha256: null,
    changed: true
  }]));
}

export function validatePublicationLedger({ ledger, registry, manifest }) {
  assert(ledger?.schemaVersion === PUBLICATION_LEDGER_VERSION, "New People publication ledger schema version is invalid");
  assert(ledger.ordering === "tmdb-person-id-ascending", "New People publication ledger ordering is invalid");
  assert(Array.isArray(ledger.records), "New People publication ledger records must be an array");
  const registryById = new Map(registry.people.map((person) => [person.tmdbPersonId, person]));
  const manifestById = new Map(manifest.people.map((person) => [person.tmdbPersonId, person]));
  let previous = 0;
  for (const record of ledger.records) {
    assert(Number.isSafeInteger(record.tmdbPersonId) && record.tmdbPersonId > previous,
      "New People publication ledger must contain unique ascending Person IDs");
    previous = record.tmdbPersonId;
    const registered = registryById.get(record.tmdbPersonId);
    const published = manifestById.get(record.tmdbPersonId);
    assert(registered && published, `${record.tmdbPersonId}: publication ledger identity is not registered and published`);
    assert(record.canonicalName === registered.canonicalName, `${record.tmdbPersonId}: publication ledger name drifted`);
    assert(JSON.stringify(record.categoryMembership) === JSON.stringify(registered.categoryMembership),
      `${record.tmdbPersonId}: publication ledger categories drifted`);
    assert(record.destination === `assets/people/${record.tmdbPersonId}`,
      `${record.tmdbPersonId}: publication ledger destination drifted`);
    assert(HASH.test(record.candidateReportSha256 || "") && HASH.test(record.heroSelectionSha256 || "")
      && HASH.test(record.sourceSnapshotSha256 || ""), `${record.tmdbPersonId}: publication evidence hash is invalid`);
    assert(record.heroPresetId === LOCKED_HERO_PRESET_ID, `${record.tmdbPersonId}: publication hero preset drifted`);
    assert(record.status === "owner-approved" && Number.isSafeInteger(record.stagingRunId)
      && Number.isSafeInteger(record.promotionRunId) && Number.isSafeInteger(record.trackingIssue),
    `${record.tmdbPersonId}: publication approval or workflow evidence is invalid`);
    assert(JSON.stringify(Object.keys(record.assets || {}).sort()) === JSON.stringify(Object.keys(published.assets || {}).sort()),
      `${record.tmdbPersonId}: publication ledger asset set differs from the manifest`);
    for (const [key, asset] of Object.entries(record.assets || {})) {
      const manifestAsset = published.assets[key];
      assert(manifestAsset, `${record.tmdbPersonId}: ledger ${key} is missing from the manifest`);
      for (const field of ["sha256", "bytes", "width", "height", "format"]) {
        assert(asset[field] === manifestAsset[field], `${record.tmdbPersonId}: ledger ${key} ${field} drifted`);
      }
      assert(asset.filename === ASSETS[key]?.filename, `${record.tmdbPersonId}: ledger ${key} filename drifted`);
    }
  }
  return true;
}

function publicationRecord(plan, { stagingRunId, trackingIssue, promotionRunId }) {
  return {
    tmdbPersonId: plan.approval.tmdbPersonId,
    canonicalName: plan.approval.canonicalName,
    categoryMembership: [...plan.approval.categoryMembership],
    status: "owner-approved",
    stagingRunId,
    promotionRunId,
    trackingIssue,
    destination: plan.approval.destination,
    candidateGeneratedAt: plan.report.generatedAt,
    candidateReportSha256: plan.approval.candidateReportSha256,
    sourceSnapshotSha256: plan.sourceSnapshotSha256,
    heroSelectionSha256: plan.heroSelectionSha256,
    heroPresetId: plan.approval.heroPresetId,
    heroOutcome: plan.heroOutcome,
    assets: compactAssets(plan.assets)
  };
}

function promotionMarkdown(result) {
  const lines = [
    "## Reviewed new People promotion",
    "",
    `- Staging run: ${result.stagingRunId}`,
    `- Tracking issue: #${result.trackingIssue}`,
    `- Approved identities: ${result.personIds.join(", ")}`,
    `- Changed identities: ${result.identitiesChanged}`,
    `- Changed assets: ${result.assetWrites}`,
    `- Unchanged identities: ${result.identitiesUnchanged}`,
    `- Skipped unapproved staged candidates: ${result.identitiesSkipped}`,
    `- Failed identities: ${result.identitiesFailed}`,
    `- Registry records added: ${result.registryRecordsAdded}`,
    `- Manifest rebuilt: ${result.manifestRebuilt ? "yes" : "no (dry run)"}`,
    `- Network metadata requests: 0`,
    `- Image downloads or rerenders: 0`,
    "",
    "Every asset is copied byte-for-byte from the owner-approved, hash-bound staging artifact. This pull request must still be reviewed and merged manually.",
    ""
  ];
  return lines.join("\n");
}

export async function promoteReviewedCandidates({
  artifactRoot,
  approvals,
  stagingRunId,
  trackingIssue,
  promotionRunId,
  dryRun = false,
  repositoryRoot = moduleRoot,
  workRoot = defaultWorkRoot,
  inventoryBuilder = buildInventory,
  artworkOverrideConfiguration = null
}) {
  const resolvedArtifactRoot = assertPromotionWorkPath(artifactRoot, workRoot);
  assert(approvals?.version === APPROVAL_DOCUMENT_VERSION && approvals.status === "owner-approved",
    "Validated owner approvals are required");
  const resolvedArtworkOverrides = artworkOverrideConfiguration
    || await loadNewPersonArtworkOverrides({ repositoryRoot: moduleRoot });
  const discovered = await discoverCandidates(resolvedArtifactRoot);
  const candidateById = new Map();
  for (const candidate of discovered) {
    const personId = candidate.reportRecord.value?.person?.tmdbPersonId;
    assert(Number.isSafeInteger(personId), `${candidate.reportPath}: candidate Person ID is invalid`);
    assert(!candidateById.has(personId), `Staging artifacts contain duplicate candidate ${personId}`);
    candidateById.set(personId, candidate);
  }
  const plans = [];
  for (const approval of approvals.approvals) {
    const candidate = candidateById.get(approval.tmdbPersonId);
    assert(candidate, `Staging run does not contain approved TMDB Person ID ${approval.tmdbPersonId}`);
    plans.push(await verifyCandidate({ candidate, approval, artworkOverrideConfiguration: resolvedArtworkOverrides }));
  }

  const registryPath = path.join(repositoryRoot, "data", "people.json");
  const ledgerPath = path.join(repositoryRoot, "data", "people-intake-publications.json");
  const manifestPath = path.join(repositoryRoot, "manifests", "people.json");
  const [registryRecord, ledgerRecord, currentManifestRecord] = await Promise.all([
    readJsonRecord(registryPath),
    readJsonRecord(ledgerPath),
    readJsonRecord(manifestPath)
  ]);
  const registry = registryRecord.value;
  const ledger = ledgerRecord.value;
  assert(Array.isArray(registry.people), "Canonical People registry is invalid");
  validatePublicationLedger({ ledger, registry, manifest: currentManifestRecord.value });
  const registeredIds = new Set(registry.people.map((person) => person.tmdbPersonId));
  const ledgerIds = new Set(ledger.records.map((record) => record.tmdbPersonId));
  for (const plan of plans) {
    const personId = plan.approval.tmdbPersonId;
    assert(!registeredIds.has(personId), `TMDB Person ID ${personId} is already registered`);
    assert(!ledgerIds.has(personId), `TMDB Person ID ${personId} is already in the publication ledger`);
    const destination = path.join(repositoryRoot, ...plan.approval.destination.split("/"));
    try {
      await readdir(destination);
      throw new Error(`Destination already exists for TMDB Person ID ${personId}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const personIds = plans.map((plan) => plan.approval.tmdbPersonId);
  const assetWrites = plans.reduce((sum, plan) => sum + Object.keys(plan.assets).length, 0);
  const result = {
    version: "nuvio-new-person-promotion-result-v1",
    status: dryRun ? "validated-no-writes" : "promoted-to-review-branch",
    stagingRunId,
    promotionRunId,
    trackingIssue,
    personIds,
    candidatesValidated: plans.length,
    unapprovedCandidates: discovered.length - plans.length,
    identitiesChanged: dryRun ? 0 : plans.length,
    identitiesUnchanged: 0,
    identitiesSkipped: discovered.length - plans.length,
    identitiesFailed: 0,
    assetWrites: dryRun ? 0 : assetWrites,
    candidateAssetCount: assetWrites,
    registryRecordsAdded: dryRun ? 0 : plans.length,
    ledgerRecordsAdded: dryRun ? 0 : plans.length,
    manifestRebuilt: !dryRun,
    networkRequests: 0,
    downloads: 0,
    rerenders: 0,
    candidates: plans.map((plan) => ({
      tmdbPersonId: plan.approval.tmdbPersonId,
      canonicalName: plan.approval.canonicalName,
      categoryMembership: [...plan.approval.categoryMembership],
      destination: plan.approval.destination,
      candidateReportSha256: plan.approval.candidateReportSha256,
      heroSelectionSha256: plan.heroSelectionSha256,
      heroPresetId: plan.approval.heroPresetId,
      heroOutcome: plan.heroOutcome,
      assets: resultAssets(plan.assets)
    }))
  };
  if (dryRun) return { result, markdown: promotionMarkdown(result) };

  for (const plan of plans) {
    const destination = path.join(repositoryRoot, ...plan.approval.destination.split("/"));
    await mkdir(destination, { recursive: false });
    for (const asset of Object.values(plan.assets)) {
      await copyFile(asset.sourcePath, path.join(destination, asset.filename));
    }
  }
  registry.people.push(...plans.map((plan) => ({
    tmdbPersonId: plan.approval.tmdbPersonId,
    canonicalName: plan.approval.canonicalName,
    categoryMembership: [...plan.approval.categoryMembership]
  })));
  registry.people.sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  ledger.records.push(...plans.map((plan) => publicationRecord(plan, { stagingRunId, trackingIssue, promotionRunId })));
  ledger.records.sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  await Promise.all([
    writeFile(registryPath, stableJson(registry), "utf8"),
    writeFile(ledgerPath, stableJson(ledger), "utf8")
  ]);
  const manifest = await inventoryBuilder();
  await writeFile(manifestPath, stableJson(manifest), "utf8");
  validatePublicationLedger({ ledger, registry, manifest });
  return { result, markdown: promotionMarkdown(result) };
}

export const PROMOTION_HELP = `Promote exact owner-reviewed new People staging candidates\n\n  --artifact-root <path>     Downloaded staging artifact root below tools/people-intake/.work\n  --approvals-file <path>    Owner-approved hash-bound JSON document\n  --staging-run-id <id>      Successful trusted staging workflow run\n  --tracking-issue <number>  Open issue for the promotion batch\n  --promotion-run-id <id>    Current GitHub Actions run ID\n  --report-file <path>       Optional ignored JSON result\n  --summary-file <path>      Optional ignored Markdown PR body\n  --github-output <path>     Optional GitHub Actions output file\n  --dry-run                  Validate everything without permanent writes\n\nThis command performs no metadata requests, image downloads, or rerendering.\n`;

async function main() {
  const options = parsePromotionArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(PROMOTION_HELP);
    return;
  }
  const approvals = parsePromotionApprovals(await readFile(path.resolve(options.approvalsFile), "utf8"));
  const promoted = await promoteReviewedCandidates({
    artifactRoot: options.artifactRoot,
    approvals,
    stagingRunId: options.stagingRunId,
    trackingIssue: options.trackingIssue,
    promotionRunId: options.promotionRunId,
    dryRun: options.dryRun,
    repositoryRoot: canonicalRepositoryRoot()
  });
  if (options.reportFile) {
    const target = assertPromotionWorkPath(options.reportFile);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, stableJson(promoted.result), "utf8");
  }
  if (options.summaryFile) {
    const target = assertPromotionWorkPath(options.summaryFile);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, promoted.markdown, "utf8");
  }
  if (options.githubOutput) {
    await appendFile(options.githubOutput, [
      `person_ids=${promoted.result.personIds.join(",")}`,
      `person_count=${promoted.result.personIds.length}`,
      `candidate_asset_count=${promoted.result.candidateAssetCount}`,
      `promotion_status=${promoted.result.status}`
    ].join("\n") + "\n", "utf8");
  }
  process.stdout.write(`${stableJson(promoted.result)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n\n${PROMOTION_HELP}`);
    process.exitCode = 1;
  });
}
