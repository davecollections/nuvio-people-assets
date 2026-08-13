#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(toolRoot, "../..");
const presetPath = path.join(toolRoot, "presets", "people-t2-perspective-v2.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateCreditOverrides(overrides) {
  assert(overrides?.schemaVersion === 1, "Invalid credit override schema version");
  assert(Array.isArray(overrides.oneEpisodeTvRoles), "Invalid one-episode TV role overrides");
  assert(Array.isArray(overrides.blockedMedia), "Invalid blocked-media overrides");
  assert(Array.isArray(overrides.creativeCrewCredits), "Invalid creative-crew credit overrides");
  assert(overrides.blockedMedia.every((record) => record
    && (record.mediaType === "movie" || record.mediaType === "tv")
    && Number.isSafeInteger(record.mediaId)
    && record.mediaId > 0
    && typeof record.reason === "string"
    && record.reason.trim().length > 0), "Invalid blocked-media override record");
  const blockedMediaKeys = overrides.blockedMedia.map((record) => `${record.mediaType}:${record.mediaId}`);
  assert(new Set(blockedMediaKeys).size === blockedMediaKeys.length, "Duplicate blocked-media override");
  const permittedCreativeJobs = new Set(["Creator", "Original Film Writer", "Producer", "Screenplay", "Story", "Writer"]);
  assert(overrides.creativeCrewCredits.every((record) => record
    && Number.isSafeInteger(record.personId)
    && record.personId > 0
    && (record.mediaType === "movie" || record.mediaType === "tv")
    && Number.isSafeInteger(record.mediaId)
    && record.mediaId > 0
    && Array.isArray(record.jobs)
    && record.jobs.length > 0
    && record.jobs.every((job) => typeof job === "string" && permittedCreativeJobs.has(job))
    && new Set(record.jobs).size === record.jobs.length
    && typeof record.reason === "string"
    && record.reason.trim().length > 0), "Invalid creative-crew credit override record");
  const creativeCrewKeys = overrides.creativeCrewCredits
    .map((record) => `${record.personId}:${record.mediaType}:${record.mediaId}`);
  assert(new Set(creativeCrewKeys).size === creativeCrewKeys.length, "Duplicate creative-crew credit override");
  return overrides;
}

export function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function deriveLayoutSeed({ presetId, tmdbPersonId, sourceKeys = [] }) {
  assert(typeof presetId === "string" && presetId.length > 0, "presetId is required");
  assert(Number.isInteger(tmdbPersonId) && tmdbPersonId > 0, "tmdbPersonId must be a positive integer");
  assert(Array.isArray(sourceKeys) && sourceKeys.every((key) => typeof key === "string"), "sourceKeys must be strings");
  const digest = createHash("sha256")
    .update(`${presetId}\n${tmdbPersonId}\n${sourceKeys.join("\n")}\n`, "utf8")
    .digest();
  return (digest.readUInt32BE(0) & 0x7fffffff) || 1;
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
  npm run people-hero:preflight -- --person-id <tmdb-person-id>

Validates one registered identity and the v2 local generator. It makes no request and writes nothing.
`;
}

function validatePersonCandidate(person, personId) {
  assert(person && person.tmdbPersonId === personId, "People candidate identity does not match the requested Person ID");
  assert(person.stableKey === `person:${personId}`, "People candidate stable key does not match the requested Person ID");
  assert(typeof person.canonicalName === "string" && person.canonicalName.trim(), "People candidate canonical name is required");
  assert(Array.isArray(person.categoryMembership) && person.categoryMembership.length > 0,
    "People candidate category membership is required");
  assert(person.categoryMembership.every((category) => category === "actor" || category === "director"),
    "People candidate category membership is invalid");
  assert(new Set(person.categoryMembership).size === person.categoryMembership.length,
    "People candidate category membership contains duplicates");
  return {
    stableKey: person.stableKey,
    tmdbPersonId: person.tmdbPersonId,
    canonicalName: person.canonicalName.trim(),
    categoryMembership: [...person.categoryMembership]
  };
}

export async function buildPreflight({ personId, personCandidate = null }) {
  assert(Number.isInteger(personId) && personId > 0, "--person-id must be exactly one positive TMDB Person ID");
  const [registry, preset, overrides, compositorSource, postprocessorSource] = await Promise.all([
    readFile(path.join(repositoryRoot, "data", "people.json"), "utf8").then(JSON.parse),
    readFile(presetPath, "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "data", "hero-credit-overrides.json"), "utf8").then(JSON.parse),
    readFile(path.join(toolRoot, "vendor", "prism-t2-compositor.py")),
    readFile(path.join(toolRoot, "src", "stage.mjs"))
  ]);
  const registeredPerson = registry.people.find((record) => record.tmdbPersonId === personId) || null;
  const person = registeredPerson || (personCandidate ? validatePersonCandidate(personCandidate, personId) : null);
  assert(person, `TMDB Person ID ${personId} is not present in data/people.json`);
  if (registeredPerson && personCandidate) {
    const candidate = validatePersonCandidate(personCandidate, personId);
    assert(candidate.canonicalName === registeredPerson.canonicalName
      && JSON.stringify(candidate.categoryMembership) === JSON.stringify(registeredPerson.categoryMembership),
    `People candidate for ${personId} differs from the registered identity`);
  }
  assert(preset.id === "people-t2-perspective-v2", "Unexpected People hero preset ID");
  assert(preset.width === 2560 && preset.height === 1440 && preset.quality === 82, "People hero output lock mismatch");
  assert(preset.filmography.minimumCredits === 15 && preset.filmography.maximumCredits === 32, "Filmography thresholds changed unexpectedly");
  assert(preset.profileOnly.minimumProfiles === 15 && preset.profileOnly.maximumProfiles === 24, "Profile-only thresholds changed unexpectedly");
  assert(preset.sparseFallback?.id === "people-t2-cinematic-defocus-fallback-v1"
    && preset.sparseFallback.minimumCredits === 1
    && preset.sparseFallback.blurSigma === 34
    && preset.sparseFallback.saturation === 0.82
    && preset.sparseFallback.brightness === 0.7
    && preset.sparseFallback.titleLogoBakedIn === false,
  "Sparse fallback output lock mismatch");
  validateCreditOverrides(overrides);

  return {
    status: "preflight-passed-no-generation",
    person,
    identityOrigin: registeredPerson ? "canonical-registry" : "staged-unregistered-candidate",
    preset,
    overrides,
    renderer: {
      path: "tools/people-hero/vendor/prism-t2-compositor.py",
      sha256: createHash("sha256").update(compositorSource).digest("hex"),
      postprocessor: {
        path: "tools/people-hero/src/stage.mjs",
        sha256: createHash("sha256").update(postprocessorSource).digest("hex")
      }
    },
    runtime: {
      proxyUrlConfigured: Boolean(process.env.PEOPLE_HERO_PROXY_URL?.trim()),
      proxyServiceTokenConfigured: Boolean(process.env.PEOPLE_HERO_PROXY_TOKEN?.trim()),
      pythonConfigured: Boolean(process.env.PEOPLE_HERO_PYTHON?.trim())
    },
    boundaries: { metadataRequests: 0, imageDownloads: 0, generatedAssets: 0, permanentAssetWrites: 0, manifestWrites: 0, publishActions: 0 }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else process.stdout.write(`${JSON.stringify(await buildPreflight(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    process.exitCode = 1;
  }
}
