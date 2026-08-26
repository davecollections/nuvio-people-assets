#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isPathInside } from "./preflight.mjs";
import { stableJson } from "./refresh-state.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = path.join(toolRoot, ".work");

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

export async function buildRefreshIssueBundle({ artifactRoot, outputRoot, runId, runUrl, allowedWorkRoot = workRoot }) {
  const resolvedArtifacts = path.resolve(artifactRoot);
  const resolvedOutput = path.resolve(outputRoot);
  assert(isPathInside(allowedWorkRoot, resolvedArtifacts) && isPathInside(allowedWorkRoot, resolvedOutput),
    "Refresh issue evidence must stay below tools/people-hero/.work");
  await mkdir(resolvedOutput, { recursive: true });
  const files = await walk(resolvedArtifacts);
  const auditPaths = files.filter((file) => path.basename(file) === "refresh-audit.json");
  assert(auditPaths.length === 1, "Refresh issue bundle requires exactly one audit report");
  const audit = JSON.parse(await readFile(auditPaths[0], "utf8"));
  assert(["audit-complete", "incomplete-no-staging"].includes(audit.status),
    "Refresh issue bundle requires an audit report");
  const changes = audit.changes || [];
  const failures = audit.failures || [];
  const reviewPaths = files.filter((file) => path.basename(file) === "refresh-review.json");
  const reviews = [];
  for (const reviewPath of reviewPaths) reviews.push(JSON.parse(await readFile(reviewPath, "utf8")));
  reviews.sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  const reviewById = new Map(reviews.map((review) => [review.tmdbPersonId, review]));
  const expectedStageIds = changes.filter((change) => change.selectedForStaging)
    .map((change) => change.tmdbPersonId);
  const missingStageIds = expectedStageIds.filter((personId) => !reviewById.has(personId));
  const approvalDocument = {
    version: "nuvio-people-hero-refresh-approval-batch-v1",
    status: "needs-owner-review",
    approvals: reviews.map((review) => ({
      tmdbPersonId: review.tmdbPersonId,
      expectedPublishedHeroSha256: review.expectedPublishedHeroSha256,
      candidateHeroSha256: review.candidateHeroSha256,
      candidateReportSha256: review.candidateReportSha256,
      heroSelectionSha256: review.heroSelectionSha256,
      sourceSnapshotSha256: review.sourceSnapshotSha256,
      heroPresetId: review.heroPresetId,
      destination: review.destination
    }))
  };
  const lines = [
    `## People hero refresh review`,
    "",
    `- Actions run: [${runId}](${runUrl})`,
    `- Audited identities: ${audit.requestedPersonCount}`,
    `- Audit status: ${audit.status}`,
    `- Material changes: ${audit.changeCount || 0}`,
    `- Candidates staged: ${reviews.length}`,
    `- Metadata failures: ${failures.length}`,
    `- Attention-only identities: ${audit.attentionCount || 0}`,
    `- Automatic-stage overflow: ${audit.overflowCount || 0}`,
    `- Failed candidate stages: ${missingStageIds.length}`,
    "",
    "No published asset, manifest, branch, pull request, or merge was changed by this run.",
    ""
  ];
  if (reviews.length > 0) {
    lines.push("### Staged candidates", "");
    for (const review of reviews) {
      const change = changes.find((item) => item.tmdbPersonId === review.tmdbPersonId);
      lines.push(
        `#### ${change?.canonicalName || review.canonicalName} (${review.tmdbPersonId})`,
        "",
        `- Reason: ${(change?.reasons || []).join(", ")}`,
        `- Expected current hero SHA-256: \`${review.expectedPublishedHeroSha256}\``,
        `- Candidate hero SHA-256: \`${review.candidateHeroSha256}\``,
        `- Candidate report SHA-256: \`${review.candidateReportSha256}\``,
        `- Hero selection SHA-256: \`${review.heroSelectionSha256}\``,
        `- Source snapshot SHA-256: \`${review.sourceSnapshotSha256}\``,
        `- Preset: \`${review.heroPresetId}\``,
        `- Destination: \`${review.destination}\``,
        ""
      );
    }
  }
  if (failures.length > 0) {
    lines.push("### Metadata failures — no candidates were staged", "");
    for (const failure of failures) lines.push(`- ${failure.canonicalName} (${failure.tmdbPersonId}): ${failure.error}`);
    lines.push("");
  }
  const attention = changes.filter((change) => change.action === "attention");
  if (attention.length > 0) {
    lines.push("### Attention required", "");
    for (const change of attention) lines.push(`- ${change.canonicalName} (${change.tmdbPersonId}): ${change.reasons.join(", ")}`);
    lines.push("");
  }
  if (audit.overflowPersonIds?.length > 0) {
    const overflow = audit.overflowPersonIds.map((personId) => {
      const change = changes.find((item) => item.tmdbPersonId === personId);
      return `${change?.canonicalName || "Unknown person"} (${personId})`;
    });
    lines.push("### Not rendered because of the 30-candidate cap", "", ...overflow.map((item) => `- ${item}`), "");
  }
  if (missingStageIds.length > 0) {
    const missing = missingStageIds.map((personId) => {
      const change = changes.find((item) => item.tmdbPersonId === personId);
      return `${change?.canonicalName || "Unknown person"} (${personId})`;
    });
    lines.push("### Candidate stages that failed", "", ...missing.map((item) => `- ${item}`), "");
  }
  lines.push("Review the uploaded candidate artifacts. Promotion requires an edited `owner-approvals.json` with status `owner-approved` and the exact reviewed hashes.", "");
  const bodyPath = path.join(resolvedOutput, "issue-body.md");
  const approvalsPath = path.join(resolvedOutput, "owner-approvals.json");
  const summaryPath = path.join(resolvedOutput, "issue-bundle.json");
  const summary = {
    version: "nuvio-people-hero-refresh-issue-bundle-v1",
    runId,
    stagedPersonIds: reviews.map((review) => review.tmdbPersonId),
    missingStageIds,
    attentionPersonIds: attention.map((change) => change.tmdbPersonId),
    overflowPersonIds: audit.overflowPersonIds || [],
    failurePersonIds: failures.map((failure) => failure.tmdbPersonId),
    issueNeeded: failures.length > 0 || (audit.changeCount || 0) > 0
  };
  await Promise.all([
    writeFile(bodyPath, `${lines.join("\n")}\n`, "utf8"),
    writeFile(approvalsPath, stableJson(approvalDocument), "utf8"),
    writeFile(summaryPath, stableJson(summary), "utf8")
  ]);
  return { bodyPath, approvalsPath, summaryPath, summary };
}

function parseArgs(argv) {
  const options = { artifactRoot: null, outputRoot: null, runId: null, runUrl: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--artifact-root") options.artifactRoot = argv[++index] || null;
    else if (argument === "--output-root") options.outputRoot = argv[++index] || null;
    else if (argument === "--run-id") options.runId = argv[++index] || null;
    else if (argument === "--run-url") options.runUrl = argv[++index] || null;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown refresh-issue argument: ${argument}`);
  }
  if (!options.help) assert(options.artifactRoot && options.outputRoot && options.runId && options.runUrl,
    "--artifact-root, --output-root, --run-id, and --run-url are required");
  return options;
}

const HELP = `Build a compact People hero refresh tracking-issue bundle from staged Actions artifacts.\n`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(HELP);
  const result = await buildRefreshIssueBundle(options);
  process.stdout.write(stableJson({
    bodyPath: result.bodyPath,
    approvalsPath: result.approvalsPath,
    summaryPath: result.summaryPath,
    ...result.summary
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n\n${HELP}`);
    process.exitCode = 1;
  });
}
