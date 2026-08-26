import { createHash } from "node:crypto";

import { PEOPLE_HERO_SELECTION_POLICY_VERSION } from "./selection-policy.mjs";

export const REFRESH_STATE_SCHEMA_VERSION = 1;
export const REFRESH_STATE_VERSION = "nuvio-people-hero-refresh-state-v1";
export const LOCKED_REFRESH_PRESET_ID = "people-t2-perspective-v2";
export const MAXIMUM_AUTOMATIC_STAGE_COUNT = 30;

const HASH = /^[a-f0-9]{64}$/u;
const SAFE_ARTWORK_PATH = /^\/[A-Za-z0-9._-]+$/u;
const RENDERABLE_OUTCOMES = new Set(["filmography", "profile-only", "sparse-fallback"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function artworkPath(value) {
  if (value === null || value === undefined || value === "") return null;
  assert(typeof value === "string" && SAFE_ARTWORK_PATH.test(value), `Unsafe official artwork path: ${value}`);
  return value;
}

function compactCredit(credit, outcome) {
  assert(credit && (credit.mediaType === "movie" || credit.mediaType === "tv"), "Refresh credit media type is invalid");
  assert(Number.isSafeInteger(credit.mediaId) && credit.mediaId > 0, "Refresh credit media ID is invalid");
  const poster = artworkPath(credit.posterPath);
  const backdrop = outcome === "sparse-fallback" && poster ? null : artworkPath(credit.backdropPath);
  assert(poster || backdrop, "Refresh credit has no effective artwork");
  return [credit.mediaType, credit.mediaId, poster, backdrop];
}

export function compactHeroSelection(selection) {
  assert(selection && ["filmography", "profile-only", "sparse-fallback", "skip"].includes(selection.outcome),
    "Refresh selection outcome is invalid");
  if (selection.outcome === "profile-only") {
    return {
      outcome: selection.outcome,
      credits: [],
      profiles: (selection.selectedProfiles || []).map((profile) => artworkPath(profile.filePath))
    };
  }
  if (selection.outcome === "filmography" || selection.outcome === "sparse-fallback") {
    return {
      outcome: selection.outcome,
      credits: (selection.selectedCredits || []).map((credit) => compactCredit(credit, selection.outcome)),
      profiles: (selection.fallbackProfiles || []).map((profile) => artworkPath(profile.filePath))
    };
  }
  return { outcome: "skip", credits: [], profiles: [] };
}

export function compactSelectionSha256(selection) {
  return sha256(stableJson(selection));
}

function validateCompactSelection(selection, label = "Refresh selection") {
  assert(selection && ["filmography", "profile-only", "sparse-fallback", "skip"].includes(selection.outcome),
    `${label} outcome is invalid`);
  assert(Array.isArray(selection.credits) && Array.isArray(selection.profiles), `${label} arrays are invalid`);
  assert(selection.credits.every((credit) => Array.isArray(credit)
    && credit.length === 4
    && (credit[0] === "movie" || credit[0] === "tv")
    && Number.isSafeInteger(credit[1])
    && credit[1] > 0
    && (credit[2] === null || SAFE_ARTWORK_PATH.test(credit[2]))
    && (credit[3] === null || SAFE_ARTWORK_PATH.test(credit[3]))
    && (credit[2] || credit[3])), `${label} contains an invalid credit`);
  assert(selection.profiles.every((profile) => typeof profile === "string" && SAFE_ARTWORK_PATH.test(profile)),
    `${label} contains an invalid profile path`);
  const mediaKeys = selection.credits.map((credit) => `${credit[0]}:${credit[1]}`);
  assert(new Set(mediaKeys).size === mediaKeys.length, `${label} contains duplicate media identities`);
  assert(new Set(selection.profiles).size === selection.profiles.length, `${label} contains duplicate profiles`);
  if (selection.outcome === "profile-only") assert(selection.credits.length === 0, `${label} profile-only mode contains credits`);
  if (selection.outcome === "skip") {
    assert(selection.credits.length === 0 && selection.profiles.length === 0, `${label} skip mode contains sources`);
  }
  return selection;
}

export function buildRefreshStateRecord({
  tmdbPersonId,
  publishedHeroSha256,
  sourceSnapshotSha256,
  selection,
  evidence = { kind: "bootstrap-current-metadata" }
}) {
  assert(Number.isSafeInteger(tmdbPersonId) && tmdbPersonId > 0, "Refresh-state Person ID is invalid");
  assert(HASH.test(publishedHeroSha256 || ""), `${tmdbPersonId}: published hero SHA-256 is invalid`);
  assert(HASH.test(sourceSnapshotSha256 || ""), `${tmdbPersonId}: source snapshot SHA-256 is invalid`);
  const compactSelection = validateCompactSelection(compactHeroSelection(selection), `${tmdbPersonId}: compact selection`);
  assert(evidence && ["bootstrap-current-metadata", "reviewed-promotion"].includes(evidence.kind),
    `${tmdbPersonId}: refresh evidence kind is invalid`);
  const compactEvidence = { kind: evidence.kind, sourceSnapshotSha256 };
  if (evidence.kind === "reviewed-promotion") {
    for (const key of ["candidateReportSha256", "heroSelectionSha256"]) {
      assert(HASH.test(evidence[key] || ""), `${tmdbPersonId}: ${key} is invalid`);
      compactEvidence[key] = evidence[key];
    }
    for (const key of ["stagingRunId", "promotionRunId", "trackingIssue"]) {
      assert(Number.isSafeInteger(evidence[key]) && evidence[key] > 0, `${tmdbPersonId}: ${key} is invalid`);
      compactEvidence[key] = evidence[key];
    }
  }
  return {
    tmdbPersonId,
    publishedHeroSha256,
    selectionSha256: compactSelectionSha256(compactSelection),
    selection: compactSelection,
    evidence: compactEvidence
  };
}

export function buildRefreshState(records) {
  const ordered = [...records].sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  return {
    schemaVersion: REFRESH_STATE_SCHEMA_VERSION,
    version: REFRESH_STATE_VERSION,
    ordering: "tmdb-person-id-ascending",
    presetId: LOCKED_REFRESH_PRESET_ID,
    selectionPolicyVersion: PEOPLE_HERO_SELECTION_POLICY_VERSION,
    recordCount: ordered.length,
    records: ordered
  };
}

export function validateRefreshState({ state, registry = null, manifest = null }) {
  assert(state?.schemaVersion === REFRESH_STATE_SCHEMA_VERSION && state.version === REFRESH_STATE_VERSION,
    "People hero refresh-state schema is invalid");
  assert(state.ordering === "tmdb-person-id-ascending", "People hero refresh-state ordering is invalid");
  assert(state.presetId === LOCKED_REFRESH_PRESET_ID, "People hero refresh-state preset drifted");
  assert(state.selectionPolicyVersion === PEOPLE_HERO_SELECTION_POLICY_VERSION,
    "People hero refresh-state selection policy drifted");
  assert(Array.isArray(state.records) && state.recordCount === state.records.length,
    "People hero refresh-state record count is invalid");
  const registryById = registry ? new Map(registry.people.map((person) => [person.tmdbPersonId, person])) : null;
  const manifestById = manifest ? new Map(manifest.people.map((person) => [person.tmdbPersonId, person])) : null;
  let previousId = 0;
  for (const record of state.records) {
    assert(Number.isSafeInteger(record.tmdbPersonId) && record.tmdbPersonId > previousId,
      "People hero refresh-state IDs must be unique and ascending");
    previousId = record.tmdbPersonId;
    assert(HASH.test(record.publishedHeroSha256 || ""), `${record.tmdbPersonId}: refresh-state hero hash is invalid`);
    validateCompactSelection(record.selection, `${record.tmdbPersonId}: refresh-state selection`);
    assert(record.selectionSha256 === compactSelectionSha256(record.selection),
      `${record.tmdbPersonId}: refresh-state selection hash drifted`);
    assert(record.evidence && ["bootstrap-current-metadata", "reviewed-promotion"].includes(record.evidence.kind)
      && HASH.test(record.evidence.sourceSnapshotSha256 || ""), `${record.tmdbPersonId}: refresh-state evidence is invalid`);
    if (record.evidence.kind === "reviewed-promotion") {
      assert(HASH.test(record.evidence.candidateReportSha256 || "")
        && HASH.test(record.evidence.heroSelectionSha256 || "")
        && [record.evidence.stagingRunId, record.evidence.promotionRunId, record.evidence.trackingIssue]
          .every((value) => Number.isSafeInteger(value) && value > 0),
      `${record.tmdbPersonId}: reviewed refresh-state evidence is invalid`);
    }
    if (registryById) assert(registryById.has(record.tmdbPersonId), `${record.tmdbPersonId}: refresh-state identity is not registered`);
    if (manifestById) {
      const published = manifestById.get(record.tmdbPersonId);
      assert(published?.assets?.hero?.sha256 === record.publishedHeroSha256,
        `${record.tmdbPersonId}: refresh-state hero hash differs from the manifest`);
    }
  }
  if (registryById) assert(state.records.length === registry.people.length,
    "People hero refresh-state does not cover every registered identity");
  if (manifestById) assert(state.records.length === manifest.people.length,
    "People hero refresh-state does not cover every manifest identity");
  return true;
}

function mediaIdentity(credit) {
  return `${credit[0]}:${credit[1]}`;
}

function sourceIdentity(credit) {
  return `${mediaIdentity(credit)}:${credit[2] || ""}:${credit[3] || ""}`;
}

function sourceSets(selection) {
  return new Set([
    ...selection.credits.map(sourceIdentity),
    ...selection.profiles.map((profile) => `profile:${profile}`)
  ]);
}

export function compareRefreshSelections(baseline, current, { force = false } = {}) {
  validateCompactSelection(baseline, "Baseline refresh selection");
  validateCompactSelection(current, "Current refresh selection");
  const result = {
    action: "none",
    reasons: [],
    metrics: {
      addedOrChangedSources: 0,
      removedOrChangedSources: 0,
      materialChangeCount: 0,
      newTopEightCredits: []
    }
  };
  if (force) {
    result.action = current.outcome === "skip" ? "attention" : "stage";
    result.reasons.push(current.outcome === "skip" ? "forced-refresh-now-skips" : "manual-force");
    return result;
  }
  if (baseline.outcome !== current.outcome) {
    result.action = current.outcome === "skip" ? "attention" : "stage";
    result.reasons.push(`outcome-changed:${baseline.outcome}->${current.outcome}`);
    return result;
  }
  if (!RENDERABLE_OUTCOMES.has(current.outcome)) return result;

  const baselineSources = sourceSets(baseline);
  const currentSources = sourceSets(current);
  result.metrics.addedOrChangedSources = [...currentSources].filter((key) => !baselineSources.has(key)).length;
  result.metrics.removedOrChangedSources = [...baselineSources].filter((key) => !currentSources.has(key)).length;
  result.metrics.materialChangeCount = Math.max(
    result.metrics.addedOrChangedSources,
    result.metrics.removedOrChangedSources
  );

  if (current.outcome === "profile-only") {
    if (result.metrics.materialChangeCount >= 3) {
      result.action = "stage";
      result.reasons.push("three-profile-sources-changed");
    }
    return result;
  }

  const baselineMedia = new Set(baseline.credits.map(mediaIdentity));
  result.metrics.newTopEightCredits = current.credits.slice(0, 8)
    .map(mediaIdentity)
    .filter((key) => !baselineMedia.has(key));
  if (result.metrics.newTopEightCredits.length > 0) {
    result.action = "stage";
    result.reasons.push("new-credit-entered-top-eight");
  }
  if (result.metrics.materialChangeCount >= 2) {
    result.action = "stage";
    result.reasons.push("two-selected-sources-changed");
  }
  return result;
}

export function sortRefreshCandidates(candidates) {
  const priority = (candidate) => {
    const reasons = candidate.comparison?.reasons || [];
    if (reasons.some((reason) => reason.startsWith("outcome-changed:sparse-fallback->"))) return 0;
    if (reasons.includes("new-credit-entered-top-eight")) return 1;
    if (reasons.some((reason) => reason.startsWith("outcome-changed:"))) return 2;
    return 3;
  };
  return [...candidates].sort((left, right) => priority(left) - priority(right)
    || (right.comparison?.metrics?.materialChangeCount || 0) - (left.comparison?.metrics?.materialChangeCount || 0)
    || left.tmdbPersonId - right.tmdbPersonId);
}

export function partitionRefreshCandidates(candidates, stageLimit = MAXIMUM_AUTOMATIC_STAGE_COUNT) {
  assert(Number.isSafeInteger(stageLimit) && stageLimit > 0 && stageLimit <= MAXIMUM_AUTOMATIC_STAGE_COUNT,
    "Refresh candidate partition limit is invalid");
  const ordered = sortRefreshCandidates(candidates);
  return {
    selected: ordered.slice(0, stageLimit),
    overflow: ordered.slice(stageLimit)
  };
}

export function upsertRefreshStateRecord(state, record) {
  const retained = state.records.filter((item) => item.tmdbPersonId !== record.tmdbPersonId);
  return buildRefreshState([...retained, record]);
}
