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

export async function buildPreflight({ personId }) {
  assert(Number.isInteger(personId) && personId > 0, "--person-id must be exactly one positive TMDB Person ID");
  const [registry, preset, overrides, compositorSource] = await Promise.all([
    readFile(path.join(repositoryRoot, "data", "people.json"), "utf8").then(JSON.parse),
    readFile(presetPath, "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "data", "hero-credit-overrides.json"), "utf8").then(JSON.parse),
    readFile(path.join(toolRoot, "vendor", "prism-t2-compositor.py"))
  ]);
  const person = registry.people.find((record) => record.tmdbPersonId === personId);
  assert(person, `TMDB Person ID ${personId} is not present in data/people.json`);
  assert(preset.id === "people-t2-perspective-v2", "Unexpected People hero preset ID");
  assert(preset.width === 2560 && preset.height === 1440 && preset.quality === 82, "People hero output lock mismatch");
  assert(preset.filmography.minimumCredits === 15 && preset.filmography.maximumCredits === 32, "Filmography thresholds changed unexpectedly");
  assert(preset.profileOnly.minimumProfiles === 15 && preset.profileOnly.maximumProfiles === 24, "Profile-only thresholds changed unexpectedly");
  assert(overrides.schemaVersion === 1 && Array.isArray(overrides.oneEpisodeTvRoles), "Invalid credit override file");

  return {
    status: "preflight-passed-no-generation",
    person,
    preset,
    overrides,
    renderer: {
      path: "tools/people-hero/vendor/prism-t2-compositor.py",
      sha256: createHash("sha256").update(compositorSource).digest("hex")
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
