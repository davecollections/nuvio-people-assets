#!/usr/bin/env node

import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { buildInventory, repositoryRoot as canonicalRepositoryRoot } from "../../../scripts/lib/inventory.mjs";
import { isPathInside } from "./preflight.mjs";
import {
  buildRefreshStateRecord,
  LOCKED_REFRESH_PRESET_ID,
  sha256,
  stableJson,
  upsertRefreshStateRecord,
  validateRefreshState
} from "./refresh-state.mjs";

export const REFRESH_APPROVAL_DOCUMENT_VERSION = "nuvio-people-hero-refresh-approval-batch-v1";
export const MAXIMUM_REFRESH_PROMOTION_COUNT = 30;

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultWorkRoot = path.join(moduleRoot, "tools", "people-hero", ".work");
const HASH = /^[a-f0-9]{64}$/u;
const APPROVAL_KEYS = new Set([
  "tmdbPersonId",
  "expectedPublishedHeroSha256",
  "candidateHeroSha256",
  "candidateReportSha256",
  "heroSelectionSha256",
  "sourceSnapshotSha256",
  "heroPresetId",
  "destination"
]);
const CANDIDATE_FILES = new Set([
  "reports/candidate-report.json",
  "reports/compositor-report.json",
  "reports/refresh-review.json",
  "reports/review-approval-template.json",
  "reports/selection.json",
  "reports/source-snapshot.json",
  "staging/hero.webp"
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, label) {
  const raw = String(value ?? "").trim();
  assert(/^[1-9]\d*$/u.test(raw), `${label} must be a positive integer`);
  const result = Number(raw);
  assert(Number.isSafeInteger(result), `${label} is outside the safe integer range`);
  return result;
}

export function parseRefreshPromotionApprovals(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error("Refresh promotion approvals must be valid JSON");
  }
  assert(document?.version === REFRESH_APPROVAL_DOCUMENT_VERSION,
    `Refresh approval version must be ${REFRESH_APPROVAL_DOCUMENT_VERSION}`);
  assert(document.status === "owner-approved", "Refresh approvals must have owner-approved status");
  assert(Array.isArray(document.approvals) && document.approvals.length > 0,
    "Refresh approvals must contain at least one candidate");
  assert(document.approvals.length <= MAXIMUM_REFRESH_PROMOTION_COUNT,
    `Refresh promotion accepts at most ${MAXIMUM_REFRESH_PROMOTION_COUNT} candidates`);
  const seen = new Set();
  const approvals = document.approvals.map((approval, index) => {
    assert(approval && typeof approval === "object" && !Array.isArray(approval), `Refresh approval ${index + 1} is invalid`);
    assert(Object.keys(approval).length === APPROVAL_KEYS.size
      && Object.keys(approval).every((key) => APPROVAL_KEYS.has(key)),
    `Refresh approval ${index + 1} must contain only the exact reviewed fields`);
    const tmdbPersonId = positiveInteger(approval.tmdbPersonId, `Refresh approval ${index + 1} Person ID`);
    assert(!seen.has(tmdbPersonId), `Duplicate refresh approval for TMDB Person ID ${tmdbPersonId}`);
    seen.add(tmdbPersonId);
    for (const key of [
      "expectedPublishedHeroSha256",
      "candidateHeroSha256",
      "candidateReportSha256",
      "heroSelectionSha256",
      "sourceSnapshotSha256"
    ]) assert(HASH.test(approval[key] || ""), `${tmdbPersonId}: ${key} is invalid`);
    assert(approval.heroPresetId === LOCKED_REFRESH_PRESET_ID, `${tmdbPersonId}: refresh preset is invalid`);
    assert(approval.destination === `assets/people/${tmdbPersonId}/hero.webp`, `${tmdbPersonId}: refresh destination is invalid`);
    return { ...approval, tmdbPersonId };
  });
  return { version: document.version, status: document.status, approvals };
}

export function assertRefreshPromotionWorkPath(target, workRoot = defaultWorkRoot) {
  const resolved = path.resolve(target);
  assert(isPathInside(workRoot, resolved), "Refresh promotion evidence must stay below tools/people-hero/.work");
  return resolved;
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(target));
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

async function readRecord(filePath) {
  const bytes = await readFile(filePath);
  return { value: JSON.parse(bytes.toString("utf8")), bytes, sha256: sha256(bytes), path: filePath };
}

async function discoverReviews(artifactRoot) {
  const files = await walk(artifactRoot);
  return files.filter((file) => path.basename(file) === "refresh-review.json").sort();
}

async function verifyCandidate({ reviewPath, approval, manifestById, stateById }) {
  const reportsRoot = path.dirname(reviewPath);
  const candidateRoot = path.dirname(reportsRoot);
  const candidateFiles = (await walk(candidateRoot))
    .map((file) => path.relative(candidateRoot, file).split(path.sep).join("/"))
    .sort();
  assert(candidateFiles.length === CANDIDATE_FILES.size
    && candidateFiles.every((file) => CANDIDATE_FILES.has(file)),
  `${approval.tmdbPersonId}: staged refresh candidate contains an unexpected file set`);
  const paths = {
    review: reviewPath,
    report: path.join(reportsRoot, "candidate-report.json"),
    selection: path.join(reportsRoot, "selection.json"),
    snapshot: path.join(reportsRoot, "source-snapshot.json"),
    candidate: path.join(candidateRoot, "staging", "hero.webp")
  };
  const [reviewRecord, reportRecord, selectionRecord, snapshotRecord, candidateBytes] = await Promise.all([
    readRecord(paths.review),
    readRecord(paths.report),
    readRecord(paths.selection),
    readRecord(paths.snapshot),
    readFile(paths.candidate)
  ]);
  const review = reviewRecord.value;
  const personId = approval.tmdbPersonId;
  assert(review.version === "nuvio-people-hero-refresh-review-v1" && review.status === "needs-owner-review",
    `${personId}: refresh review record is invalid`);
  for (const key of APPROVAL_KEYS) assert(review[key] === approval[key], `${personId}: approved ${key} differs from staged review evidence`);
  assert(reportRecord.sha256 === approval.candidateReportSha256, `${personId}: candidate report hash differs from approval`);
  assert(selectionRecord.sha256 === approval.heroSelectionSha256, `${personId}: selection hash differs from approval`);
  assert(snapshotRecord.sha256 === approval.sourceSnapshotSha256, `${personId}: source snapshot hash differs from approval`);
  assert(sha256(candidateBytes) === approval.candidateHeroSha256, `${personId}: candidate hero hash differs from approval`);
  const report = reportRecord.value;
  assert(report.version === "nuvio-people-hero-candidate-v2" && report.status === "staging-only-needs-owner-review",
    `${personId}: candidate report is not a reviewable V2 hero`);
  assert(report.person?.tmdbPersonId === personId && snapshotRecord.value?.id === personId,
    `${personId}: staged identity evidence differs from approval`);
  assert(report.preset?.id === LOCKED_REFRESH_PRESET_ID && report.output?.sha256 === approval.candidateHeroSha256,
    `${personId}: staged preset or output differs from approval`);
  assert(Object.values(report.boundaries || {}).every((value) => value === 0), `${personId}: candidate report crossed a publication boundary`);
  const metadata = await sharp(candidateBytes, { failOn: "error" }).metadata();
  assert(metadata.format === "webp" && metadata.width === 2560 && metadata.height === 1440,
    `${personId}: candidate hero output contract is invalid`);
  assert(candidateBytes.length <= 1024 * 1024, `${personId}: candidate hero exceeds the 1 MiB limit`);
  const published = manifestById.get(personId);
  const refreshState = stateById.get(personId);
  assert(published?.assets?.hero?.sha256 === approval.expectedPublishedHeroSha256,
    `${personId}: published hero changed after owner review`);
  assert(refreshState?.publishedHeroSha256 === approval.expectedPublishedHeroSha256,
    `${personId}: refresh-state hero changed after owner review`);
  return {
    personId,
    approval,
    selection: selectionRecord.value,
    sourceSnapshotSha256: snapshotRecord.sha256,
    candidateBytes,
    candidatePath: paths.candidate,
    changed: approval.candidateHeroSha256 !== approval.expectedPublishedHeroSha256
  };
}

function promotionMarkdown(result) {
  return [
    "## Reviewed People hero refresh promotion",
    "",
    `- Staging run: ${result.stagingRunId}`,
    `- Tracking issue: #${result.trackingIssue}`,
    `- Approved identities: ${result.personIds.join(", ")}`,
    `- Changed hero files: ${result.assetWrites}`,
    `- Baseline-only updates: ${result.baselineOnlyUpdates}`,
    `- Manifest rebuilt: ${result.manifestRebuilt ? "yes" : "no (dry run)"}`,
    "- Metadata requests: 0",
    "- Image downloads or rerenders: 0",
    "",
    "Only exact owner-reviewed hero bytes and their compact refresh-state records are included. The draft pull request must still be reviewed and merged manually.",
    ""
  ].join("\n");
}

export async function promoteReviewedRefreshes({
  artifactRoot,
  approvals,
  stagingRunId,
  trackingIssue,
  promotionRunId,
  dryRun = false,
  repositoryRoot = moduleRoot,
  workRoot = defaultWorkRoot,
  inventoryBuilder = buildInventory
}) {
  const resolvedArtifacts = assertRefreshPromotionWorkPath(artifactRoot, workRoot);
  assert(approvals?.version === REFRESH_APPROVAL_DOCUMENT_VERSION && approvals.status === "owner-approved",
    "Validated owner refresh approvals are required");
  const registryPath = path.join(repositoryRoot, "data", "people.json");
  const manifestPath = path.join(repositoryRoot, "manifests", "people.json");
  const refreshStatePath = path.join(repositoryRoot, "data", "people-hero-refresh-state.json");
  const [registry, manifest, refreshState, reviewPaths] = await Promise.all([
    readFile(registryPath, "utf8").then(JSON.parse),
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(refreshStatePath, "utf8").then(JSON.parse),
    discoverReviews(resolvedArtifacts)
  ]);
  validateRefreshState({ state: refreshState, registry, manifest });
  const manifestById = new Map(manifest.people.map((person) => [person.tmdbPersonId, person]));
  const stateById = new Map(refreshState.records.map((record) => [record.tmdbPersonId, record]));
  const reviewById = new Map();
  for (const reviewPath of reviewPaths) {
    const review = JSON.parse(await readFile(reviewPath, "utf8"));
    assert(Number.isSafeInteger(review.tmdbPersonId), `${reviewPath}: refresh review Person ID is invalid`);
    assert(!reviewById.has(review.tmdbPersonId), `Staging artifacts contain duplicate refresh candidate ${review.tmdbPersonId}`);
    reviewById.set(review.tmdbPersonId, reviewPath);
  }
  const plans = [];
  for (const approval of approvals.approvals) {
    const reviewPath = reviewById.get(approval.tmdbPersonId);
    assert(reviewPath, `Staging run does not contain approved refresh candidate ${approval.tmdbPersonId}`);
    plans.push(await verifyCandidate({ reviewPath, approval, manifestById, stateById }));
  }
  const result = {
    version: "nuvio-people-hero-refresh-promotion-result-v1",
    status: dryRun ? "validated-no-writes" : "promoted-to-review-branch",
    stagingRunId,
    promotionRunId,
    trackingIssue,
    personIds: plans.map((plan) => plan.personId),
    candidatesValidated: plans.length,
    assetWrites: dryRun ? 0 : plans.filter((plan) => plan.changed).length,
    baselineOnlyUpdates: dryRun ? 0 : plans.filter((plan) => !plan.changed).length,
    refreshStateRecordsUpdated: dryRun ? 0 : plans.length,
    manifestRebuilt: !dryRun,
    metadataRequests: 0,
    downloads: 0,
    rerenders: 0
  };
  if (dryRun) return { result, markdown: promotionMarkdown(result) };

  let updatedState = refreshState;
  for (const plan of plans) {
    if (plan.changed) await copyFile(plan.candidatePath, path.join(repositoryRoot, ...plan.approval.destination.split("/")));
    updatedState = upsertRefreshStateRecord(updatedState, buildRefreshStateRecord({
      tmdbPersonId: plan.personId,
      publishedHeroSha256: plan.approval.candidateHeroSha256,
      sourceSnapshotSha256: plan.sourceSnapshotSha256,
      selection: plan.selection,
      evidence: {
        kind: "reviewed-promotion",
        candidateReportSha256: plan.approval.candidateReportSha256,
        heroSelectionSha256: plan.approval.heroSelectionSha256,
        stagingRunId,
        promotionRunId,
        trackingIssue
      }
    }));
  }
  const rebuiltManifest = await inventoryBuilder();
  validateRefreshState({ state: updatedState, registry, manifest: rebuiltManifest });
  await Promise.all([
    writeFile(refreshStatePath, stableJson(updatedState), "utf8"),
    writeFile(manifestPath, stableJson(rebuiltManifest), "utf8")
  ]);
  return { result, markdown: promotionMarkdown(result) };
}

export function parseRefreshPromotionArguments(argv) {
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
      options[key] = argv[++index] || null;
    } else if (["--staging-run-id", "--tracking-issue", "--promotion-run-id"].includes(argument)) {
      const key = {
        "--staging-run-id": "stagingRunId",
        "--tracking-issue": "trackingIssue",
        "--promotion-run-id": "promotionRunId"
      }[argument];
      options[key] = positiveInteger(argv[++index], key);
    } else throw new Error(`Unknown refresh-promotion argument: ${argument}`);
  }
  if (!options.help) assert(options.artifactRoot && options.approvalsFile && options.stagingRunId
    && options.trackingIssue && options.promotionRunId, "Refresh promotion required arguments are missing");
  return options;
}

export const REFRESH_PROMOTION_HELP = `Promote exact owner-reviewed registered People hero candidates\n\n  --artifact-root <path>\n  --approvals-file <path>\n  --staging-run-id <id>\n  --tracking-issue <id>\n  --promotion-run-id <id>\n  --report-file <path>\n  --summary-file <path>\n  --github-output <path>\n  --dry-run\n`;

async function main() {
  const options = parseRefreshPromotionArguments(process.argv.slice(2));
  if (options.help) return process.stdout.write(REFRESH_PROMOTION_HELP);
  const approvals = parseRefreshPromotionApprovals(await readFile(path.resolve(options.approvalsFile), "utf8"));
  const promoted = await promoteReviewedRefreshes({
    artifactRoot: options.artifactRoot,
    approvals,
    stagingRunId: options.stagingRunId,
    trackingIssue: options.trackingIssue,
    promotionRunId: options.promotionRunId,
    dryRun: options.dryRun,
    repositoryRoot: canonicalRepositoryRoot()
  });
  if (options.reportFile) {
    const target = assertRefreshPromotionWorkPath(options.reportFile);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, stableJson(promoted.result), "utf8");
  }
  if (options.summaryFile) {
    const target = assertRefreshPromotionWorkPath(options.summaryFile);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, promoted.markdown, "utf8");
  }
  if (options.githubOutput) await appendFile(options.githubOutput, [
    `person_ids=${promoted.result.personIds.join(",")}`,
    `person_count=${promoted.result.personIds.length}`,
    `asset_writes=${promoted.result.assetWrites}`,
    `promotion_status=${promoted.result.status}`
  ].join("\n") + "\n", "utf8");
  process.stdout.write(stableJson(promoted.result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n\n${REFRESH_PROMOTION_HELP}`);
    process.exitCode = 1;
  });
}
