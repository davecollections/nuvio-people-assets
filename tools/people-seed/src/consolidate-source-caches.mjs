#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readSourceCacheIndex } from "./people-artwork/source-resolution.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const destinationRoot = path.join(packageRoot, ".work", "migrated-source-cache-v1");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseConsolidationArguments(argv) {
  const options = { sourceCaches: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source-cache") {
      options.sourceCaches.push(path.resolve(takeValue(argv, index, argument)));
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown source-cache consolidation argument: ${argument}`);
    }
  }
  options.sourceCaches = [...new Set(options.sourceCaches)];
  if (!options.help && options.sourceCaches.length < 1) throw new Error("At least one explicit --source-cache is required.");
  return options;
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

function bindingKey(stableKey, profilePath, sourceHash) {
  return `${stableKey}\0${profilePath}\0${sourceHash}`;
}

export async function consolidateSourceCaches({ sourceCaches } = {}) {
  if (await exists(destinationRoot)) throw new Error(`Refusing to replace existing migrated source cache: ${destinationRoot}`);
  const temporaryRoot = `${destinationRoot}.${process.pid}.tmp`;
  if (await exists(temporaryRoot)) throw new Error(`Temporary source-cache migration workspace already exists: ${temporaryRoot}`);
  const legacyManifest = JSON.parse(await fs.readFile(path.join(repoRoot, "data", "people-base", "legacy-artwork-manifest.json"), "utf8"));
  const available = new Map();
  let inputEntryCount = 0;
  for (const sourceCache of sourceCaches) {
    const index = await readSourceCacheIndex(sourceCache);
    for (const entry of index.entries) {
      inputEntryCount += 1;
      const sourcePath = path.isAbsolute(entry.sourceFile) ? entry.sourceFile : path.resolve(sourceCache, entry.sourceFile);
      if (!(await exists(sourcePath))) continue;
      const key = bindingKey(entry.stableKey, entry.profilePath, entry.sourceHash);
      if (!available.has(key)) available.set(key, { entry, sourcePath });
    }
  }
  await fs.mkdir(path.join(temporaryRoot, "sources"), { recursive: true });
  const entries = [];
  let hardLinks = 0;
  let fallbackRecords = 0;
  for (const record of legacyManifest.records) {
    if (record.fallbackUsed) {
      fallbackRecords += 1;
      continue;
    }
    const key = bindingKey(record.stableKey, record.resolvedProfilePath, record.sourceHash);
    const binding = available.get(key);
    if (!binding) throw new Error(`${record.stableKey}: exact source bytes are absent from the supplied caches.`);
    const sourceBuffer = await fs.readFile(binding.sourcePath);
    if (sha256(sourceBuffer) !== record.sourceHash) throw new Error(`${record.stableKey}: source bytes differ from the legacy manifest hash.`);
    const extension = path.extname(binding.sourcePath).toLowerCase() || ".bin";
    const sourceFile = `sources/${record.tmdbPersonId}-${record.sourceHash.slice(0, 12)}${extension}`;
    const destination = path.join(temporaryRoot, sourceFile);
    try {
      await fs.link(binding.sourcePath, destination);
    } catch (error) {
      throw new Error(`${record.stableKey}: hard-link creation failed (${error.code || "unknown"}). Source caches and this repository must be on the same hard-link-capable volume.`, { cause: error });
    }
    hardLinks += 1;
    entries.push({
      stableKey: record.stableKey,
      profilePath: record.resolvedProfilePath,
      sourceFile,
      sourceHash: record.sourceHash,
      width: record.sourceDimensions.width,
      height: record.sourceDimensions.height,
      exifOrientation: binding.entry.exifOrientation || 1,
      cacheKind: "migrated-exact-approved-source",
    });
  }
  entries.sort((left, right) => left.stableKey.localeCompare(right.stableKey) || left.profilePath.localeCompare(right.profilePath));
  const index = { version: "people-portrait-source-cache-v1", ordering: "stable-key-then-profile-path", entries };
  const summary = {
    version: "people-source-cache-migration-v1",
    destinationRoot,
    sourceCacheCount: sourceCaches.length,
    inputEntryCount,
    expectedRecordCount: legacyManifest.recordCount,
    sourceRecordCount: entries.length,
    fallbackRecordCount: fallbackRecords,
    hardLinks,
    hardLinkRequirement: "same-volume-hard-link-support",
    copies: 0,
    networkRequests: 0,
    complete: entries.length + fallbackRecords === legacyManifest.recordCount,
  };
  await atomicWrite(path.join(temporaryRoot, "index.json"), Buffer.from(`${JSON.stringify(index, null, 2)}\n`));
  await atomicWrite(path.join(temporaryRoot, "migration-summary.json"), Buffer.from(`${JSON.stringify(summary, null, 2)}\n`));
  await fs.rename(temporaryRoot, destinationRoot);
  return summary;
}

export const CONSOLIDATION_HELP = `Consolidate exact legacy People portrait sources into the new ignored workspace\n\n  --source-cache <path>   Required; repeat for every historical cache\n\nExisting source bytes are hash-verified. The command requires the caches and repository to share a hard-link-capable filesystem volume; it fails closed and never silently copies source artwork. No network requests are made.\n`;

async function main() {
  const options = parseConsolidationArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(CONSOLIDATION_HELP);
    return;
  }
  process.stdout.write(`${JSON.stringify(await consolidateSourceCaches(options), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
