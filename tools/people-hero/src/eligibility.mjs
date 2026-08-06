#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPreflight, isPathInside } from "./preflight.mjs";
import { planPersonHero } from "./selection-policy.mjs";
import { createTmdbProxyClient } from "./tmdb-proxy-client.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = path.join(toolRoot, ".work");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = { personId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--person-id") {
      const value = argv[++index] || "";
      options.personId = /^[1-9]\d*$/u.test(value) ? Number(value) : null;
    }
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return `Usage:
  npm run people-hero:eligibility -- --person-id <id>

Requires PEOPLE_HERO_PROXY_URL and, when enabled by the Worker, PEOPLE_HERO_PROXY_TOKEN.
Makes one metadata request, downloads no artwork, requires no Python, and writes one compact
result below tools/people-hero/.work.
`;
}

function rejectionReasonCounts(records) {
  const counts = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const reason = typeof record?.reason === "string" && record.reason ? record.reason : "unknown";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([reason, count]) => ({ reason, count }));
}

export function buildEligibilityReport({ person, preset, selection }) {
  assert(person && Number.isSafeInteger(person.tmdbPersonId) && person.tmdbPersonId > 0, "Registered person is required");
  assert(preset?.id === "people-t2-perspective-v2", "Locked People hero preset is required");
  assert(["filmography", "profile-only", "skip"].includes(selection?.outcome), "Selection outcome is invalid");

  return {
    version: "nuvio-people-hero-eligibility-v1",
    status: "eligibility-only-no-generation",
    person: {
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName
    },
    preset: {
      id: preset.id,
      minimumCredits: preset.filmography.minimumCredits,
      maximumCredits: preset.filmography.maximumCredits,
      minimumProfiles: preset.profileOnly.minimumProfiles,
      maximumProfiles: preset.profileOnly.maximumProfiles
    },
    selection: {
      outcome: selection.outcome,
      reason: selection.reason || null,
      eligibleCreditCount: selection.eligibleCreditCount,
      usableProfileCount: selection.usableProfileCount,
      selectedCreditCount: Array.isArray(selection.selectedCredits) ? selection.selectedCredits.length : 0,
      selectedProfileCount: Array.isArray(selection.selectedProfiles) ? selection.selectedProfiles.length : 0,
      fallbackProfileCount: Array.isArray(selection.fallbackProfiles) ? selection.fallbackProfiles.length : 0,
      rejectionReasonCounts: rejectionReasonCounts(selection.rejected)
    },
    requests: { metadata: 1, imageDownloads: 0 },
    boundaries: { generatedAssets: 0, permanentAssetWrites: 0, manifestWrites: 0, publishActions: 0 }
  };
}

async function allocateAttempt(personId) {
  await mkdir(workRoot, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const attempt = path.join(workRoot, `eligibility-attempt-${timestamp}-person-${personId}${suffix ? `-${suffix}` : ""}`);
    try {
      await mkdir(attempt);
      assert(isPathInside(workRoot, attempt), "Eligibility path escaped the ignored People hero workspace");
      return attempt;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a non-destructive eligibility attempt directory");
}

async function writeEligibilityResult({ personId, report }) {
  const attemptRoot = await allocateAttempt(personId);
  await writeFile(path.join(attemptRoot, "eligibility.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return attemptRoot;
}

export async function checkEligibility({
  personId,
  fetchImpl = globalThis.fetch,
  proxyClient = null,
  resultWriter = writeEligibilityResult
}) {
  const preflight = await buildPreflight({ personId });
  const client = proxyClient || createTmdbProxyClient({ fetchImpl });
  const snapshot = await client.getPersonSnapshot(personId);
  const selection = planPersonHero(snapshot, preflight.overrides, {
    minimumCredits: preflight.preset.filmography.minimumCredits,
    maximumCredits: preflight.preset.filmography.maximumCredits,
    minimumProfiles: preflight.preset.profileOnly.minimumProfiles,
    maximumProfiles: preflight.preset.profileOnly.maximumProfiles
  });
  const report = buildEligibilityReport({ person: preflight.person, preset: preflight.preset, selection });
  const attemptRoot = await resultWriter({ personId, report });
  return { attemptRoot, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else {
      const result = await checkEligibility(options);
      process.stdout.write(`${JSON.stringify({ attemptRoot: result.attemptRoot, ...result.report }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    process.exitCode = 1;
  }
}
