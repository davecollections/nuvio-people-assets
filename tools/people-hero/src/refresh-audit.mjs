#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateCreditOverrides, isPathInside } from "./preflight.mjs";
import {
  buildRefreshState,
  buildRefreshStateRecord,
  compactHeroSelection,
  compactSelectionSha256,
  compareRefreshSelections,
  MAXIMUM_AUTOMATIC_STAGE_COUNT,
  partitionRefreshCandidates,
  sha256,
  stableJson,
  validateRefreshState
} from "./refresh-state.mjs";
import { planPersonHero } from "./selection-policy.mjs";
import { createTmdbProxyClient } from "./tmdb-proxy-client.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(toolRoot, "../..");
const workRoot = path.join(toolRoot, ".work");
const statePath = path.join(repositoryRoot, "data", "people-hero-refresh-state.json");
const presetPath = path.join(toolRoot, "presets", "people-t2-perspective-v2.json");
const CONCURRENCY = 5;
const REQUEST_ATTEMPTS = 3;

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

function parsePersonIds(value) {
  const parts = String(value || "").split(/[\s,]+/u).filter(Boolean);
  assert(parts.length > 0, "At least one explicit Person ID is required");
  const ids = parts.map((part) => positiveInteger(part, "Person ID"));
  assert(new Set(ids).size === ids.length, "Explicit refresh Person IDs contain duplicates");
  assert(ids.length <= MAXIMUM_AUTOMATIC_STAGE_COUNT,
    `Explicit refresh audits accept at most ${MAXIMUM_AUTOMATIC_STAGE_COUNT} Person IDs`);
  return ids;
}

export function parseRefreshAuditArguments(argv) {
  const options = {
    all: false,
    bootstrap: false,
    force: false,
    personIds: null,
    outputRoot: null,
    githubOutput: null,
    stageLimit: MAXIMUM_AUTOMATIC_STAGE_COUNT,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") options.all = true;
    else if (argument === "--bootstrap") options.bootstrap = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--person-ids") options.personIds = parsePersonIds(argv[++index]);
    else if (argument === "--output-root") options.outputRoot = argv[++index] || null;
    else if (argument === "--github-output") options.githubOutput = argv[++index] || null;
    else if (argument === "--stage-limit") options.stageLimit = positiveInteger(argv[++index], "stage limit");
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown refresh-audit argument: ${argument}`);
  }
  if (!options.help) {
    assert(options.all !== Boolean(options.personIds), "Choose exactly one of --all or --person-ids");
    assert(!options.bootstrap || options.all, "A baseline bootstrap must cover --all registered People");
    assert(!options.force || Boolean(options.personIds), "Forced refresh is permitted only for explicit Person IDs");
    assert(options.stageLimit <= MAXIMUM_AUTOMATIC_STAGE_COUNT,
      `Automatic staging cannot exceed ${MAXIMUM_AUTOMATIC_STAGE_COUNT} candidates`);
  }
  return options;
}

async function allocateAttempt(requestedRoot = null) {
  await mkdir(workRoot, { recursive: true });
  if (requestedRoot) {
    const resolved = path.resolve(requestedRoot);
    assert(isPathInside(workRoot, resolved), "Refresh audit output must stay below tools/people-hero/.work");
    await mkdir(resolved, { recursive: false });
    return resolved;
  }
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = path.join(workRoot, `refresh-audit-${timestamp}${suffix ? `-${suffix}` : ""}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a non-destructive refresh-audit directory");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchSnapshotWithRetries({
  client,
  personId,
  attempts = REQUEST_ATTEMPTS,
  delayImpl = delay,
  onAttempt = () => {}
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      onAttempt({ personId, attempt });
      return await client.getPersonSnapshot(personId);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delayImpl(2 ** (attempt - 1) * 1000);
    }
  }
  throw new Error(`TMDB Person ID ${personId} failed after ${attempts} attempts: ${lastError?.message || "unknown error"}`);
}

async function concurrentMap(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function selectionFor(snapshot, preset, overrides) {
  return planPersonHero(snapshot, overrides, {
    minimumCredits: preset.filmography.minimumCredits,
    maximumCredits: preset.filmography.maximumCredits,
    minimumProfiles: preset.profileOnly.minimumProfiles,
    maximumProfiles: preset.profileOnly.maximumProfiles,
    minimumSparseCredits: preset.sparseFallback.minimumCredits
  });
}

function countOutcomes(records) {
  const counts = { filmography: 0, "profile-only": 0, "sparse-fallback": 0, skip: 0 };
  for (const record of records) counts[record.currentSelection.outcome] += 1;
  return counts;
}

export async function auditPeopleHeroRefresh({
  personIds = null,
  all = false,
  bootstrap = false,
  force = false,
  stageLimit = MAXIMUM_AUTOMATIC_STAGE_COUNT,
  outputRoot = null,
  githubOutput = null,
  client = null,
  delayImpl = delay,
  now = new Date()
} = {}) {
  assert(all !== Boolean(personIds), "Choose all registered People or an explicit Person ID list");
  assert(!bootstrap || all, "Baseline bootstrap must cover the complete registry");
  assert(!force || Boolean(personIds), "Forced refresh requires explicit Person IDs");
  assert(Number.isSafeInteger(stageLimit) && stageLimit > 0 && stageLimit <= MAXIMUM_AUTOMATIC_STAGE_COUNT,
    "Refresh staging limit is invalid");
  const attemptRoot = await allocateAttempt(outputRoot);
  const reportsRoot = path.join(attemptRoot, "reports");
  const snapshotsRoot = path.join(attemptRoot, "snapshots");
  await Promise.all([mkdir(reportsRoot), mkdir(snapshotsRoot)]);

  const [registry, manifest, preset, overrides] = await Promise.all([
    readFile(path.join(repositoryRoot, "data", "people.json"), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "manifests", "people.json"), "utf8").then(JSON.parse),
    readFile(presetPath, "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "data", "hero-credit-overrides.json"), "utf8").then(JSON.parse)
  ]);
  validateCreditOverrides(overrides);
  assert(preset.id === "people-t2-perspective-v2", "Refresh audit requires the locked People hero preset");
  const registryById = new Map(registry.people.map((person) => [person.tmdbPersonId, person]));
  const manifestById = new Map(manifest.people.map((person) => [person.tmdbPersonId, person]));
  const selectedIds = all ? registry.people.map((person) => person.tmdbPersonId) : [...personIds];
  for (const personId of selectedIds) assert(registryById.has(personId), `TMDB Person ID ${personId} is not registered`);

  let baselineById = null;
  if (!bootstrap) {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    validateRefreshState({ state, registry, manifest });
    baselineById = new Map(state.records.map((record) => [record.tmdbPersonId, record]));
  }
  const proxyClient = client || createTmdbProxyClient();
  let metadataRequestAttempts = 0;
  const results = await concurrentMap(selectedIds, CONCURRENCY, async (personId) => {
    const person = registryById.get(personId);
    try {
      const snapshot = await fetchSnapshotWithRetries({
        client: proxyClient,
        personId,
        delayImpl,
        onAttempt: () => { metadataRequestAttempts += 1; }
      });
      const snapshotText = stableJson(snapshot);
      const selection = selectionFor(snapshot, preset, overrides);
      const currentSelection = compactHeroSelection(selection);
      const sourceSnapshotSha256 = sha256(snapshotText);
      if (bootstrap) {
        return {
          tmdbPersonId: personId,
          canonicalName: person.canonicalName,
          currentSelection,
          sourceSnapshotSha256,
          refreshRecord: buildRefreshStateRecord({
            tmdbPersonId: personId,
            publishedHeroSha256: manifestById.get(personId).assets.hero.sha256,
            sourceSnapshotSha256,
            selection,
            evidence: { kind: "bootstrap-current-metadata" }
          })
        };
      }
      const baseline = baselineById.get(personId);
      const comparison = compareRefreshSelections(baseline.selection, currentSelection, { force });
      return {
        tmdbPersonId: personId,
        canonicalName: person.canonicalName,
        currentSelection,
        sourceSnapshotSha256,
        currentSelectionSha256: compactSelectionSha256(currentSelection),
        baselineSelectionSha256: baseline.selectionSha256,
        comparison,
        snapshot: comparison.action === "stage" ? snapshot : null
      };
    } catch (error) {
      return { tmdbPersonId: personId, canonicalName: person.canonicalName, error: error.message };
    }
  });

  const failures = results.filter((result) => result.error).map(({ tmdbPersonId, canonicalName, error }) => ({
    tmdbPersonId,
    canonicalName,
    error
  }));
  const successful = results.filter((result) => !result.error);
  const report = {
    version: "nuvio-people-hero-refresh-audit-v1",
    status: failures.length > 0 ? "incomplete-no-staging" : bootstrap ? "bootstrap-staged-needs-owner-review" : "audit-complete",
    generatedAt: now.toISOString(),
    mode: bootstrap ? "bootstrap" : all ? "scheduled-catalogue-audit" : force ? "manual-forced-audit" : "manual-explicit-audit",
    requestedPersonCount: selectedIds.length,
    metadataRequests: metadataRequestAttempts,
    uniquePeopleRequested: selectedIds.length,
    metadataRequestAttemptsMaximum: REQUEST_ATTEMPTS,
    concurrency: CONCURRENCY,
    imageDownloads: 0,
    permanentAssetWrites: 0,
    manifestWrites: 0,
    publishActions: 0,
    failures,
    outcomeCounts: countOutcomes(successful)
  };

  let stageIds = [];
  if (bootstrap && failures.length === 0) {
    const state = buildRefreshState(successful.map((result) => result.refreshRecord));
    validateRefreshState({ state, registry, manifest });
    const stateText = stableJson(state);
    const candidatePath = path.join(attemptRoot, "refresh-state.candidate.json");
    await writeFile(candidatePath, stateText, "utf8");
    report.bootstrap = {
      candidatePath: "refresh-state.candidate.json",
      candidateSha256: sha256(stateText),
      recordCount: state.recordCount
    };
  } else if (!bootstrap && failures.length === 0) {
    const changes = successful.filter((result) => result.comparison.action !== "none");
    const { selected, overflow } = partitionRefreshCandidates(
      changes.filter((result) => result.comparison.action === "stage"),
      stageLimit
    );
    stageIds = selected.map((result) => result.tmdbPersonId);
    for (const result of selected) {
      await writeFile(path.join(snapshotsRoot, `${result.tmdbPersonId}.json`), stableJson(result.snapshot), "utf8");
    }
    report.changeCount = changes.length;
    report.stageCount = selected.length;
    report.attentionCount = changes.filter((result) => result.comparison.action === "attention").length;
    report.overflowCount = overflow.length;
    report.changes = changes.map((result) => ({
      tmdbPersonId: result.tmdbPersonId,
      canonicalName: result.canonicalName,
      action: result.comparison.action,
      reasons: result.comparison.reasons,
      metrics: result.comparison.metrics,
      baselineSelectionSha256: result.baselineSelectionSha256,
      currentSelectionSha256: result.currentSelectionSha256,
      sourceSnapshotSha256: result.sourceSnapshotSha256,
      selectedForStaging: stageIds.includes(result.tmdbPersonId)
    }));
    report.overflowPersonIds = overflow.map((result) => result.tmdbPersonId);
  }
  const reportPath = path.join(reportsRoot, "refresh-audit.json");
  await writeFile(reportPath, stableJson(report), "utf8");
  if (githubOutput) {
    await appendFile(githubOutput, [
      `attempt_root=${attemptRoot.split(path.sep).join("/")}`,
      `stage_ids=${JSON.stringify(stageIds)}`,
      `stage_count=${stageIds.length}`,
      `issue_needed=${!bootstrap && (failures.length > 0 || (report.changeCount || 0) > 0) ? "true" : "false"}`,
      `audit_complete=${failures.length === 0 ? "true" : "false"}`
    ].join("\n") + "\n", "utf8");
  }
  return { attemptRoot, reportPath, report, stageIds };
}

export const REFRESH_AUDIT_HELP = `Audit registered People heroes without publishing assets\n\n  --all                       Audit every registered identity\n  --person-ids <id[,id...]>   Audit at most 30 explicit registered identities\n  --bootstrap                 Stage the one-time complete refresh-state baseline\n  --force                     Stage every explicit renderable identity\n  --stage-limit <count>       Automatic candidate cap; maximum 30\n  --output-root <path>        Optional new directory below tools/people-hero/.work\n  --github-output <path>      Optional GitHub Actions output file\n`;

async function main() {
  const options = parseRefreshAuditArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(REFRESH_AUDIT_HELP);
    return;
  }
  const result = await auditPeopleHeroRefresh(options);
  process.stdout.write(`${stableJson({
    attemptRoot: result.attemptRoot,
    reportPath: result.reportPath,
    status: result.report.status,
    requestedPersonCount: result.report.requestedPersonCount,
    stageIds: result.stageIds,
    failures: result.report.failures.length,
    bootstrap: result.report.bootstrap || null
  })}`);
  if (result.report.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n\n${REFRESH_AUDIT_HELP}`);
    process.exitCode = 1;
  });
}
