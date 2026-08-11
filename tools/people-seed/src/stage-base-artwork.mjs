#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeRenderMetadata } from "./people-artwork/metadata.mjs";
import { assertSafeOutputDirectory, renderPeopleArtwork } from "./people-artwork/renderer.mjs";
import { readSourceCacheIndex, resolveApprovedProfile } from "./people-artwork/source-resolution.mjs";
import { loadTitleLogoConfiguration, prepareTitleLogoRenderer, renderTitleLogo } from "./people-artwork/title-logo.mjs";
import { applyTitleLogoOutputOverride, loadTitleLogoOutputOverrides } from "./people-artwork/title-logo-output-overrides.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const workRoot = path.join(packageRoot, ".work");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseBaseArtworkArguments(argv) {
  const options = { personIds: [], sourceCaches: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--person-id") {
      const raw = takeValue(argv, index, argument);
      index += 1;
      for (const value of raw.split(/[\s,]+/u).filter(Boolean)) {
        if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`Invalid TMDB Person ID: ${value}`);
        options.personIds.push(Number(value));
      }
    } else if (argument === "--source-cache") {
      options.sourceCaches.push(path.resolve(takeValue(argv, index, argument)));
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown People base-artwork argument: ${argument}`);
    }
  }
  return options.help ? options : validateBaseArtworkInput(options);
}

export function validateBaseArtworkInput({ personIds, sourceCaches } = {}) {
  if (!Array.isArray(personIds) || personIds.length < 1 || personIds.length > 30) throw new Error("Select between 1 and 30 explicit TMDB Person IDs.");
  if (!personIds.every((personId) => Number.isSafeInteger(personId) && personId > 0)) throw new Error("Every TMDB Person ID must be a positive safe integer.");
  if (new Set(personIds).size !== personIds.length) throw new Error("Duplicate TMDB Person IDs are not allowed.");
  if (!Array.isArray(sourceCaches) || sourceCaches.length < 1 || !sourceCaches.every((sourceCache) => typeof sourceCache === "string" && sourceCache.trim())) {
    throw new Error("At least one explicit --source-cache is required.");
  }
  return { personIds: [...personIds], sourceCaches: [...new Set(sourceCaches.map((sourceCache) => path.resolve(sourceCache)))] };
}

async function buildCompositeSourceCache(sourceCaches, outputDir) {
  const entries = [];
  const keys = new Set();
  for (const sourceCache of sourceCaches) {
    const index = await readSourceCacheIndex(sourceCache);
    for (const entry of index.entries) {
      const key = `${entry.stableKey}\0${entry.profilePath}\0${entry.sourceHash || ""}`;
      if (keys.has(key)) continue;
      keys.add(key);
      entries.push({
        ...entry,
        sourceFile: path.isAbsolute(entry.sourceFile) ? entry.sourceFile : path.resolve(sourceCache, entry.sourceFile),
      });
    }
  }
  entries.sort((left, right) => left.stableKey.localeCompare(right.stableKey) || left.profilePath.localeCompare(right.profilePath));
  const compositeRoot = path.join(outputDir, "source-cache-binding");
  await atomicWrite(path.join(compositeRoot, "index.json"), Buffer.from(`${JSON.stringify({ version: "people-portrait-source-cache-v1", ordering: "stable-key-then-profile-path", entries }, null, 2)}\n`));
  return { compositeRoot, entryCount: entries.length };
}

function expectedAssetHash(currentRecord, kind) {
  const asset = currentRecord?.assets?.[kind];
  if (!asset?.sha256) throw new Error(`${currentRecord?.tmdbPersonId || "unknown"}: current ${kind} hash is unavailable.`);
  return asset.sha256;
}

function timestampId(now = new Date()) {
  return now.toISOString().replace(/[-:.]/gu, "");
}

export function baseArtworkAttemptName(personIds, now = new Date()) {
  const selectionHash = sha256(Buffer.from(personIds.join(","), "utf8")).slice(0, 12);
  return `attempt-${timestampId(now)}-people-base-${personIds.length}-${selectionHash}`;
}

export async function stageBaseArtwork({ personIds, sourceCaches, now = new Date() } = {}) {
  ({ personIds, sourceCaches } = validateBaseArtworkInput({ personIds, sourceCaches }));
  const [registry, decisions, legacyArtwork, legacyPresentation, currentManifest] = await Promise.all([
    readJson("data/people-base/people-registry.json"),
    readJson("data/people-base/portrait-source-decisions.json"),
    readJson("data/people-base/legacy-artwork-manifest.json"),
    readJson("data/people-base/legacy-presentation-manifest.json"),
    readJson("manifests/people.json"),
  ]);
  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));
  const legacyArtworkById = new Map(legacyArtwork.records.map((record) => [record.tmdbPersonId, record]));
  const legacyPresentationById = new Map(legacyPresentation.records.map((record) => [record.tmdbPersonId, record]));
  const currentById = new Map(currentManifest.people.map((record) => [record.tmdbPersonId, record]));
  const people = personIds.map((personId) => {
    const person = registryById.get(personId);
    const expected = legacyArtworkById.get(personId);
    const current = currentById.get(personId);
    if (!person || !expected || !current) throw new Error(`${personId}: identity is not fully bound across the migrated registry and manifests.`);
    const resolution = resolveApprovedProfile(person, decisions);
    if (resolution.profilePath !== expected.resolvedProfilePath) throw new Error(`${person.stableKey}: resolved profile path differs from the legacy source binding.`);
    return {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      profilePath: person.profilePath,
      categoryMembership: [...person.categoryMembership],
    };
  });
  const outputDir = assertSafeOutputDirectory(path.join(workRoot, baseArtworkAttemptName(personIds, now)));
  await fs.mkdir(workRoot, { recursive: true });
  await fs.mkdir(outputDir, { recursive: false });
  const sourceCache = await buildCompositeSourceCache(sourceCaches, outputDir);
  const expectedSources = new Map(personIds.map((personId) => [personId, legacyArtworkById.get(personId)]));
  const rendered = await renderPeopleArtwork({
    people,
    decisions,
    sourceCache: sourceCache.compositeRoot,
    outputDir,
    format: "both",
    expectedSources,
  });
  const renderMetadata = await writeRenderMetadata({ metadata: rendered.metadata, outputDir });
  const configuration = await loadTitleLogoConfiguration({ registry });
  const titleOutputOverrides = await loadTitleLogoOutputOverrides({ registry });
  const preparedTitles = await prepareTitleLogoRenderer({ people, configuration });
  const titleRecords = [];
  for (const person of people) {
    const baseTitle = await renderTitleLogo({ person, ...preparedTitles });
    const title = await applyTitleLogoOutputOverride({ person, rendered: baseTitle, runtime: preparedTitles.runtime, overrides: titleOutputOverrides });
    await atomicWrite(path.join(outputDir, "title-logo", `${person.tmdbPersonId}.png`), title.output);
    titleRecords.push(title.record);
  }
  await atomicWrite(path.join(outputDir, "title-logo-metadata.json"), Buffer.from(`${JSON.stringify({ rendererVersion: "people-title-logo-renderer-v5", recordCount: titleRecords.length, records: titleRecords }, null, 2)}\n`));
  const renderByKey = new Map(rendered.metadata.records.map((record) => [`${record.tmdbPersonId}:${record.formatId}`, record]));
  const titleById = new Map(titleRecords.map((record) => [record.tmdbPersonId, record]));
  const records = people.map((person) => {
    const expectedLegacy = legacyArtworkById.get(person.tmdbPersonId);
    const expectedLegacyTitle = legacyPresentationById.get(person.tmdbPersonId);
    const current = currentById.get(person.tmdbPersonId);
    const poster = renderByKey.get(`${person.tmdbPersonId}:poster`);
    const landscape = renderByKey.get(`${person.tmdbPersonId}:landscape`);
    const titleLogo = titleById.get(person.tmdbPersonId);
    const comparisons = {
      poster: { generated: poster.outputHash, current: expectedAssetHash(current, "poster"), legacy: expectedLegacy.posterHash },
      landscape: { generated: landscape.outputHash, current: expectedAssetHash(current, "landscape"), legacy: expectedLegacy.landscapeHash },
      titleLogo: { generated: titleLogo.outputHash, current: expectedAssetHash(current, "titleLogo"), legacy: expectedLegacyTitle.titleLogoSha256 },
    };
    return {
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      sourceProfilePath: expectedLegacy.resolvedProfilePath,
      sourceHash: expectedLegacy.sourceHash,
      fallbackUsed: poster.fallbackUsed || landscape.fallbackUsed,
      comparisons,
      matchesCurrent: Object.values(comparisons).every((comparison) => comparison.generated === comparison.current),
      matchesLegacy: Object.values(comparisons).every((comparison) => comparison.generated === comparison.legacy),
    };
  });
  const report = {
    version: "people-base-artwork-migration-proof-v1",
    generatedAt: now.toISOString(),
    stagingOnly: true,
    networkRequests: 0,
    sourceCaches: sourceCaches.map((sourceCachePath) => path.resolve(sourceCachePath)),
    compositeSourceEntryCount: sourceCache.entryCount,
    personIds,
    recordCount: records.length,
    allMatchCurrent: records.every((record) => record.matchesCurrent),
    allMatchLegacy: records.every((record) => record.matchesLegacy),
    records,
    renderMetadata,
  };
  const reportPath = path.join(outputDir, "migration-proof.json");
  await atomicWrite(reportPath, Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
  if (!report.allMatchCurrent) throw new Error(`Migration proof differs from current published bytes. Inspect ${reportPath}`);
  return { outputDir, reportPath, report };
}

export const BASE_ARTWORK_HELP = `Stage legacy People poster, landscape, and title-logo reproduction\n\n  --person-id <id[,id...]>   Required; 1-30 registered IDs\n  --source-cache <path>      Required; repeat for multiple offline caches\n\nThe command makes no network requests and writes only beneath tools/people-seed/.work.\n`;

async function main() {
  const options = parseBaseArtworkArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(BASE_ARTWORK_HELP);
    return;
  }
  const result = await stageBaseArtwork(options);
  process.stdout.write(`${JSON.stringify({ valid: true, outputDir: result.outputDir, reportPath: result.reportPath, personIds: options.personIds, networkRequests: 0 }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
