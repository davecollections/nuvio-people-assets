#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isPathInside } from "./preflight.mjs";
import { sha256, stableJson } from "./refresh-state.mjs";
import { stageCandidate } from "./stage.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(toolRoot, "../..");
const workRoot = path.join(toolRoot, ".work");

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

export function parseRefreshStageArguments(argv) {
  const options = {
    personId: null,
    sourceSnapshotPath: null,
    outputRoot: null,
    pythonExecutable: process.env.PEOPLE_HERO_PYTHON?.trim() || "python",
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--person-id") options.personId = positiveInteger(argv[++index], "Person ID");
    else if (argument === "--source-snapshot") options.sourceSnapshotPath = argv[++index] || null;
    else if (argument === "--output-root") options.outputRoot = argv[++index] || null;
    else if (argument === "--python") options.pythonExecutable = argv[++index] || null;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown refresh-stage argument: ${argument}`);
  }
  if (!options.help) {
    assert(options.personId, "--person-id is required");
    assert(options.pythonExecutable, "--python or PEOPLE_HERO_PYTHON is required");
  }
  return options;
}

export async function stageRefreshCandidate({
  personId,
  sourceSnapshotPath = null,
  outputRoot = null,
  pythonExecutable,
  fetchImpl = globalThis.fetch
}) {
  let sourceSnapshot = null;
  if (sourceSnapshotPath) {
    const resolvedSnapshot = path.resolve(sourceSnapshotPath);
    assert(isPathInside(workRoot, resolvedSnapshot), "Refresh source snapshot must stay below tools/people-hero/.work");
    sourceSnapshot = JSON.parse(await readFile(resolvedSnapshot, "utf8"));
    assert(sourceSnapshot.id === personId, "Refresh source snapshot identity mismatch");
  }
  const resolvedOutput = outputRoot ? path.resolve(outputRoot) : null;
  if (resolvedOutput) assert(isPathInside(workRoot, resolvedOutput),
    "Refresh candidate output must stay below tools/people-hero/.work");
  const staged = await stageCandidate({
    personId,
    pythonExecutable,
    fetchImpl,
    sourceSnapshot,
    attemptRoot: resolvedOutput
  });
  assert(staged.report.status !== "skipped", `${personId}: refresh candidate became ineligible during staging`);
  const reportsRoot = path.join(staged.attemptRoot, "reports");
  const [registry, manifest, candidateReportBytes, selectionBytes, snapshotBytes, candidateBytes] = await Promise.all([
    readFile(path.join(repositoryRoot, "data", "people.json"), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "manifests", "people.json"), "utf8").then(JSON.parse),
    readFile(path.join(reportsRoot, "candidate-report.json")),
    readFile(path.join(reportsRoot, "selection.json")),
    readFile(path.join(reportsRoot, "source-snapshot.json")),
    readFile(path.join(staged.attemptRoot, "staging", "hero.webp"))
  ]);
  const person = registry.people.find((record) => record.tmdbPersonId === personId);
  const published = manifest.people.find((record) => record.tmdbPersonId === personId);
  assert(person && published?.assets?.hero, `${personId}: registered publication evidence is missing`);
  const review = {
    version: "nuvio-people-hero-refresh-review-v1",
    status: "needs-owner-review",
    tmdbPersonId: personId,
    canonicalName: person.canonicalName,
    expectedPublishedHeroSha256: published.assets.hero.sha256,
    candidateHeroSha256: sha256(candidateBytes),
    candidateReportSha256: sha256(candidateReportBytes),
    heroSelectionSha256: sha256(selectionBytes),
    sourceSnapshotSha256: sha256(snapshotBytes),
    heroPresetId: staged.report.preset.id,
    destination: `assets/people/${personId}/hero.webp`,
    candidatePath: "staging/hero.webp",
    boundaries: { permanentAssetWrites: 0, manifestWrites: 0, publishActions: 0 }
  };
  assert(review.candidateHeroSha256 === staged.report.output.sha256,
    `${personId}: staged candidate bytes differ from the candidate report`);
  await Promise.all([
    writeFile(path.join(reportsRoot, "refresh-review.json"), stableJson(review), "utf8"),
    writeFile(path.join(reportsRoot, "review-approval-template.json"), stableJson({
      version: "nuvio-people-hero-refresh-approval-batch-v1",
      status: "needs-owner-review",
      approvals: [{
        tmdbPersonId: review.tmdbPersonId,
        expectedPublishedHeroSha256: review.expectedPublishedHeroSha256,
        candidateHeroSha256: review.candidateHeroSha256,
        candidateReportSha256: review.candidateReportSha256,
        heroSelectionSha256: review.heroSelectionSha256,
        sourceSnapshotSha256: review.sourceSnapshotSha256,
        heroPresetId: review.heroPresetId,
        destination: review.destination
      }]
    }), "utf8")
  ]);
  return { attemptRoot: staged.attemptRoot, report: staged.report, review };
}

export const REFRESH_STAGE_HELP = `Stage one registered People hero refresh candidate\n\n  --person-id <id>            Required registered TMDB Person ID\n  --source-snapshot <path>    Optional audited snapshot below tools/people-hero/.work\n  --output-root <path>        Optional new candidate directory below tools/people-hero/.work\n  --python <executable>       Optional compositor Python executable\n`;

async function main() {
  const options = parseRefreshStageArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(REFRESH_STAGE_HELP);
    return;
  }
  const result = await stageRefreshCandidate(options);
  process.stdout.write(stableJson({
    attemptRoot: result.attemptRoot,
    status: result.report.status,
    tmdbPersonId: result.review.tmdbPersonId,
    expectedPublishedHeroSha256: result.review.expectedPublishedHeroSha256,
    candidateHeroSha256: result.review.candidateHeroSha256,
    candidateReportSha256: result.review.candidateReportSha256,
    heroSelectionSha256: result.review.heroSelectionSha256,
    sourceSnapshotSha256: result.review.sourceSnapshotSha256
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n\n${REFRESH_STAGE_HELP}`);
    process.exitCode = 1;
  });
}
