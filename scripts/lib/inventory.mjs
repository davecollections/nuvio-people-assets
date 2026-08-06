import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const assetsRoot = path.join(root, "assets", "people");
const registryPath = path.join(root, "data", "people.json");
const baseUrl = "https://raw.githubusercontent.com/davecollections/nuvio-people-assets/main/";

const assetDefinitions = {
  poster: { filename: "poster.webp", required: true, format: "webp" },
  titleLogo: { filename: "title-logo.png", required: true, format: "png" },
  landscape: { filename: "landscape.webp", required: false, format: "webp" },
  hero: { filename: "hero.webp", required: false, format: "webp" }
};

function slash(value) {
  return value.split(path.sep).join("/");
}

async function inspectAsset(relativePath, expectedFormat) {
  const absolutePath = path.join(root, relativePath);
  const [content, fileStat, metadata] = await Promise.all([
    readFile(absolutePath),
    stat(absolutePath),
    sharp(absolutePath).metadata()
  ]);

  if (metadata.format !== expectedFormat) {
    throw new Error(`${relativePath}: expected ${expectedFormat}, found ${metadata.format ?? "unknown"}`);
  }
  if (!metadata.width || !metadata.height) {
    throw new Error(`${relativePath}: dimensions could not be read`);
  }
  if (fileStat.size > 1024 * 1024) {
    throw new Error(`${relativePath}: ${fileStat.size} bytes exceeds the 1 MiB per-file ceiling`);
  }

  return {
    path: slash(relativePath),
    url: baseUrl + slash(relativePath),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: fileStat.size,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format
  };
}

export async function buildInventory() {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  if (!Array.isArray(registry.people) || registry.people.length === 0) {
    throw new Error("data/people.json must contain a non-empty people array");
  }

  const ordered = [...registry.people].sort((a, b) => a.tmdbPersonId - b.tmdbPersonId);
  const seenIds = new Set();
  for (const person of ordered) {
    if (!Number.isInteger(person.tmdbPersonId) || person.tmdbPersonId <= 0) {
      throw new Error(`Invalid TMDB person ID: ${person.tmdbPersonId}`);
    }
    if (seenIds.has(person.tmdbPersonId)) {
      throw new Error(`Duplicate TMDB person ID: ${person.tmdbPersonId}`);
    }
    seenIds.add(person.tmdbPersonId);
  }

  const directoryNames = (await readdir(assetsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => Number(a) - Number(b));
  const expectedNames = ordered.map((person) => String(person.tmdbPersonId));
  if (JSON.stringify(directoryNames) !== JSON.stringify(expectedNames)) {
    throw new Error("assets/people directories do not exactly match data/people.json");
  }

  const assetCounts = { poster: 0, titleLogo: 0, landscape: 0, hero: 0 };
  let totalBytes = 0;
  const people = [];

  for (const person of ordered) {
    const directory = path.join(assetsRoot, String(person.tmdbPersonId));
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    const allowed = new Set(Object.values(assetDefinitions).map((definition) => definition.filename));
    const unexpected = entries.filter((name) => !allowed.has(name));
    if (unexpected.length > 0) {
      throw new Error(`${person.tmdbPersonId}: unexpected files: ${unexpected.join(", ")}`);
    }

    const assets = {};
    for (const [key, definition] of Object.entries(assetDefinitions)) {
      const exists = entries.includes(definition.filename);
      if (definition.required && !exists) {
        throw new Error(`${person.tmdbPersonId}: missing required ${definition.filename}`);
      }
      if (!exists) continue;

      const relativePath = path.join("assets", "people", String(person.tmdbPersonId), definition.filename);
      const inspected = await inspectAsset(relativePath, definition.format);
      if (key === "hero") {
        if (inspected.width !== 1920 || inspected.height !== 1080) {
          throw new Error(`${inspected.path}: hero must be exactly 1920x1080`);
        }
        if (inspected.bytes > 250 * 1024) {
          throw new Error(`${inspected.path}: hero exceeds the 250 KiB rollout budget`);
        }
      }
      assets[key] = inspected;
      assetCounts[key] += 1;
      totalBytes += inspected.bytes;
    }

    people.push({
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      categoryMembership: person.categoryMembership,
      assets
    });
  }

  return {
    schemaVersion: 1,
    repository: "davecollections/nuvio-people-assets",
    ordering: "tmdb-person-id-ascending",
    recordCount: people.length,
    assetCounts,
    totalAssetBytes: totalBytes,
    heroPreset: {
      id: "people-filmography-t2-perspective-24-v1",
      width: 1920,
      height: 1080,
      creditCount: 24,
      layout: "t2-perspective",
      format: "webp",
      quality: 82,
      sourcePolicy: "official-tmdb-artwork-only"
    },
    people
  };
}

export function repositoryRoot() {
  return root;
}
